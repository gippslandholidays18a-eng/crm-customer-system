import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, X, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

const LEAVE_TYPES = ["Annual Leave", "Sick Leave", "Personal Leave", "Public Holiday", "Unpaid Leave", "Other"];
const SHIFT_TYPES = ["Work Day", "On Call", "Training", "Other"];
const COLORS = ["#D9A05B", "#5BD1A8", "#7AB8FF", "#B486E0", "#E0904E", "#E05A50", "#16B5C6", "#F2C94C", "#9B59B6", "#3498DB"];

const fmt = (d) => d.toISOString().slice(0, 10);
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };

export default function StaffCalendar() {
  const { user } = useAuth();
  const isMgr = user?.role === "admin" || user?.role === "manager";
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [users, setUsers] = useState([]);
  const [filterStaff, setFilterStaff] = useState("");
  const [shifts, setShifts] = useState([]);
  const [timeoff, setTimeoff] = useState([]);
  const [pending, setPending] = useState([]);
  const [showShift, setShowShift] = useState(false);
  const [showTimeoff, setShowTimeoff] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(null);
  const [declineReason, setDeclineReason] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const range = useMemo(() => {
    if (view === "month") return { start: fmt(startOfMonth(cursor)), end: fmt(endOfMonth(cursor)) };
    const s = startOfWeek(cursor); const e = new Date(s); e.setDate(e.getDate() + 6);
    return { start: fmt(s), end: fmt(e) };
  }, [view, cursor]);

  useEffect(() => {
    if (isMgr) api.get("/users/assignable").then((r) => setUsers(r.data.items || [])).catch(() => {});
    else setUsers([user]);
  }, [isMgr, user]);

  useEffect(() => {
    const params = { start: range.start, end: range.end };
    if (filterStaff) params.staff_member_id = filterStaff;
    Promise.all([
      api.get("/staff/shifts", { params }),
      api.get("/staff/time-off", { params: filterStaff ? { staff_member_id: filterStaff } : {} }),
      isMgr ? api.get("/staff/time-off", { params: { status: "Pending" } }) : Promise.resolve({ data: { items: [] } }),
    ]).then(([s, t, p]) => {
      setShifts(s.data.items || []);
      setTimeoff(t.data.items || []);
      setPending(p.data.items || []);
    }).catch(() => {});
  }, [range.start, range.end, filterStaff, version, isMgr]);

  const colorFor = (sid) => {
    const idx = users.findIndex((u) => u.id === sid);
    return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
  };

  const approve = async (t) => {
    try { await api.post(`/staff/time-off/${t.id}/approve`); toast.success("Approved"); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const decline = async () => {
    if (!declineReason.trim()) { toast.error("Reason required"); return; }
    try {
      await api.post(`/staff/time-off/${declineOpen.id}/decline`, { reason: declineReason });
      toast.success("Declined"); setDeclineOpen(null); setDeclineReason(""); refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="staff-calendar-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Team</div>
          <h1 className="font-display text-3xl tracking-tight mt-1">{isMgr ? "Staff calendar" : "My calendar"}</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isMgr && <button onClick={() => setShowShift(true)} data-testid="new-shift-btn" className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"><Plus className="w-4 h-4" />New shift</button>}
          <button onClick={() => setShowTimeoff(true)} data-testid="new-timeoff-btn" className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md hover:border-[#3A3F4C]"><Plus className="w-4 h-4" />Time off</button>
        </div>
      </header>

      {isMgr && pending.length > 0 && (
        <div className="surface rounded-md p-4" data-testid="pending-requests">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim mb-3">Pending time-off requests ({pending.length})</div>
          <div className="space-y-2">
            {pending.map((t) => (
              <div key={t.id} data-testid={`pending-${t.id}`} className="flex items-center gap-3 text-xs border border-[#22252F] rounded-md p-2">
                <div className="flex-1">
                  <div className="text-white">{t.staff_member_name} · {t.leave_type}</div>
                  <div className="text-dim">{t.start_date} → {t.end_date} · {t.notes || "—"}</div>
                </div>
                <button onClick={() => approve(t)} data-testid={`approve-${t.id}`} className="text-[#5BD1A8] hover:text-white inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />Approve</button>
                <button onClick={() => { setDeclineOpen(t); setDeclineReason(""); }} data-testid={`decline-${t.id}`} className="text-[#E05A50] hover:text-white inline-flex items-center gap-1"><X className="w-3.5 h-3.5" />Decline</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="text-dim hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
        <div className="font-display text-lg tabular-nums" data-testid="calendar-cursor">
          {cursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="text-dim hover:text-white"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setCursor(new Date())} className="text-[11px] text-dim hover:text-white ml-2">Today</button>
        <div className="ml-auto flex gap-1">
          <button onClick={() => setView("month")} data-testid="view-month" className={`text-xs px-3 py-1 rounded-full border ${view === "month" ? "bg-[#1A1D24] border-[#22252F]" : "border-transparent text-dim hover:text-white"}`}>Month</button>
          <button onClick={() => setView("week")} data-testid="view-week" className={`text-xs px-3 py-1 rounded-full border ${view === "week" ? "bg-[#1A1D24] border-[#22252F]" : "border-transparent text-dim hover:text-white"}`}>Week</button>
        </div>
        {isMgr && (
          <Select value={filterStaff || "__all__"} onValueChange={(v) => setFilterStaff(v === "__all__" ? "" : v)}>
            <SelectTrigger data-testid="filter-staff" className="w-48 bg-transparent border-[#22252F] text-sm ml-2"><SelectValue placeholder="All staff" /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
              <SelectItem value="__all__">All staff</SelectItem>
              {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <CalendarGrid view={view} cursor={cursor} shifts={shifts} timeoff={timeoff} colorFor={colorFor} />

      {(isMgr && showShift) && <ShiftModal users={users.filter((u) => u.role !== "admin" || true)} onClose={() => setShowShift(false)} onSaved={() => { setShowShift(false); refresh(); }} />}
      {showTimeoff && <TimeOffModal isMgr={isMgr} users={users} selfId={user.id} onClose={() => setShowTimeoff(false)} onSaved={() => { setShowTimeoff(false); refresh(); }} />}

      {declineOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setDeclineOpen(null)}>
          <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg">Decline request</div>
            <div className="text-xs text-dim">{declineOpen.staff_member_name} · {declineOpen.leave_type}</div>
            <Textarea value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason (required)" data-testid="decline-reason" className="bg-transparent border-[#22252F] text-sm" rows={3} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeclineOpen(null)} className="text-sm text-dim px-3 py-2">Cancel</button>
              <button onClick={decline} data-testid="decline-submit" className="bg-[#E05A50] text-black text-sm font-medium px-4 py-2 rounded-md">Decline</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarGrid({ view, cursor, shifts, timeoff, colorFor }) {
  const days = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(cursor);
      return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
    }
    const first = startOfMonth(cursor); const last = endOfMonth(cursor);
    const grid = []; const before = first.getDay();
    for (let i = 0; i < before; i++) { const d = new Date(first); d.setDate(d.getDate() - (before - i)); grid.push(d); }
    for (let i = 1; i <= last.getDate(); i++) grid.push(new Date(cursor.getFullYear(), cursor.getMonth(), i));
    while (grid.length % 7 !== 0) { const d = new Date(grid[grid.length - 1]); d.setDate(d.getDate() + 1); grid.push(d); }
    return grid;
  }, [view, cursor]);

  const eventsFor = (day) => {
    const iso = fmt(day);
    const dayShifts = shifts.filter((s) => s.date === iso);
    const dayOff = timeoff.filter((t) => t.start_date <= iso && iso <= t.end_date);
    return [...dayShifts.map((s) => ({ ...s, _kind: "shift" })), ...dayOff.map((t) => ({ ...t, _kind: "timeoff" }))];
  };

  return (
    <div className="surface rounded-md overflow-hidden" data-testid={`calendar-${view}`}>
      <div className="grid grid-cols-7 text-[10px] uppercase tracking-[0.15em] text-[#6B7280] bg-[#0E1015]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center border-r border-[#1A1D24] last:border-r-0">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const evs = eventsFor(day);
          return (
            <div key={i} data-testid={`day-${fmt(day)}`}
                 className={`min-h-24 p-1.5 border-t border-r border-[#1A1D24] ${inMonth ? "" : "opacity-40"}`}>
              <div className="text-[10px] tabular-nums text-dim">{day.getDate()}</div>
              <div className="mt-1 space-y-1">
                {evs.slice(0, 3).map((e, idx) => {
                  const c = colorFor(e.staff_member_id);
                  if (e._kind === "shift") {
                    return <div key={idx} className="text-[10px] rounded px-1 py-0.5 text-black font-medium truncate" style={{ backgroundColor: c }} title={`${e.staff_member_name} · ${e.shift_type}`}>{e.staff_member_name}</div>;
                  }
                  const pending = e.status === "Pending";
                  return <div key={idx} className="text-[10px] rounded px-1 py-0.5 truncate border" style={{ borderColor: c, color: c, background: c + (pending ? "10" : "22") }} title={`${e.staff_member_name} · ${e.leave_type}${pending ? " (pending)" : ""}`}>{e.leave_type}</div>;
                })}
                {evs.length > 3 && <div className="text-[9px] text-dim">+{evs.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShiftModal({ users, onClose, onSaved }) {
  const [d, setD] = useState({ staff_member_id: users[0]?.id || "", date: new Date().toISOString().slice(0, 10), shift_type: "Work Day", start_time: "09:00", end_time: "17:00", notes: "" });
  const save = async () => {
    if (!d.staff_member_id) { toast.error("Pick a staff member"); return; }
    try { await api.post("/staff/shifts", d); toast.success("Shift added"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="shift-modal">
        <div className="font-display text-lg">New shift</div>
        <Select value={d.staff_member_id} onValueChange={(v) => setD({ ...d, staff_member_id: v })}>
          <SelectTrigger data-testid="shift-staff" className="bg-transparent border-[#22252F]"><SelectValue placeholder="Staff member" /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}</SelectContent>
        </Select>
        <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} data-testid="shift-date" className="bg-transparent border-[#22252F]" />
        <div className="grid grid-cols-2 gap-2">
          <Input type="time" value={d.start_time} onChange={(e) => setD({ ...d, start_time: e.target.value })} className="bg-transparent border-[#22252F]" />
          <Input type="time" value={d.end_time} onChange={(e) => setD({ ...d, end_time: e.target.value })} className="bg-transparent border-[#22252F]" />
        </div>
        <Select value={d.shift_type} onValueChange={(v) => setD({ ...d, shift_type: v })}>
          <SelectTrigger className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{SHIFT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder="Notes" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className="bg-transparent border-[#22252F]" />
        <div className="flex justify-end gap-2"><button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button><button onClick={save} data-testid="shift-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Save</button></div>
      </div>
    </div>
  );
}

function TimeOffModal({ isMgr, users, selfId, onClose, onSaved }) {
  const [d, setD] = useState({ staff_member_id: selfId, start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), leave_type: "Annual Leave", notes: "" });
  const save = async () => {
    try { await api.post("/staff/time-off", d); toast.success("Time-off submitted (pending approval)"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="timeoff-modal">
        <div className="font-display text-lg">Request time off</div>
        {isMgr && (
          <Select value={d.staff_member_id} onValueChange={(v) => setD({ ...d, staff_member_id: v })}>
            <SelectTrigger data-testid="timeoff-staff" className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={d.start_date} onChange={(e) => setD({ ...d, start_date: e.target.value })} data-testid="timeoff-start" className="bg-transparent border-[#22252F]" />
          <Input type="date" value={d.end_date} onChange={(e) => setD({ ...d, end_date: e.target.value })} data-testid="timeoff-end" className="bg-transparent border-[#22252F]" />
        </div>
        <Select value={d.leave_type} onValueChange={(v) => setD({ ...d, leave_type: v })}>
          <SelectTrigger data-testid="timeoff-type" className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{LEAVE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Textarea placeholder="Notes" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} rows={2} className="bg-transparent border-[#22252F]" />
        <div className="flex justify-end gap-2"><button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button><button onClick={save} data-testid="timeoff-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Submit</button></div>
      </div>
    </div>
  );
}
