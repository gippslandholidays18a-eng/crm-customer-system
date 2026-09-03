import { useCallback, useEffect, useState } from "react";
import { api, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, X, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLOR = { Draft: "#8F95A3", Submitted: "#7AB8FF", Approved: "#5BD1A8", Rejected: "#E05A50" };

export default function StaffHours() {
  const { user } = useAuth();
  const isMgr = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const [range, setRange] = useState({ start: "", end: "" });
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    Promise.all([
      isMgr ? api.get("/users/assignable") : Promise.resolve({ data: { items: [user] } }),
      api.get("/properties"),
    ]).then(([u, p]) => { setUsers(u.data.items || []); setProperties(p.data.items || []); });
  }, [isMgr, user]);

  useEffect(() => {
    const params = {};
    if (range.start) params.start = range.start;
    if (range.end) params.end = range.end;
    Promise.all([
      api.get("/staff/hours", { params }),
      isMgr ? api.get("/staff/hours/summary", { params }) : Promise.resolve({ data: null }),
    ]).then(([h, s]) => { setItems(h.data.items || []); setSummary(s.data); });
  }, [version, range.start, range.end, isMgr]);

  const doAction = async (r, path, body) => {
    try { await api.post(`/staff/hours/${r.id}/${path}`, body); toast.success(path); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const exportCsv = () => {
    const url = `${API}/staff/hours/export.csv?${new URLSearchParams(range).toString()}`;
    const token = localStorage.getItem("sb_token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.text()).then((t) => {
        const blob = new Blob([t], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hours.csv"; a.click();
      });
  };

  return (
    <div className="space-y-6" data-testid="staff-hours-page">
      <header className="flex justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Team</div>
          <h1 className="font-display text-3xl mt-1">{isMgr ? "Staff hours" : "My hours"}</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)} data-testid="new-hours-btn" className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md"><Plus className="w-4 h-4" />Log hours</button>
          {isMgr && <button onClick={exportCsv} data-testid="export-hours" className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md"><Download className="w-4 h-4" />Export CSV</button>}
        </div>
      </header>

      <div className="flex gap-2 flex-wrap">
        <Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} data-testid="range-start" className="w-40 bg-transparent border-[#22252F] text-sm" placeholder="Start" />
        <Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} data-testid="range-end" className="w-40 bg-transparent border-[#22252F] text-sm" placeholder="End" />
      </div>

      {summary && (
        <div className="surface rounded-md p-4" data-testid="hours-summary">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim mb-3">Summary · {summary.grand_total}h total</div>
          <div className="space-y-1">
            {summary.by_staff.map((s) => (
              <div key={s.staff_member_id} data-testid={`summary-${s.staff_member_id}`} className="flex items-center gap-3 text-xs border-t border-[#1A1D24] pt-2">
                <div className="flex-1 text-white">{s.staff_member_name}</div>
                <div className="text-dim">{s.total_hours}h</div>
                {s.any_overtime && <span className="text-[#D9A05B] inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overtime</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="surface rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0E1015]"><tr className="text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
            <th className="text-left px-4 py-3">Date</th><th className="text-left px-4 py-3">Staff</th>
            <th className="text-left px-4 py-3">Times</th><th className="text-right px-4 py-3">Hours</th>
            <th className="text-left px-4 py-3">Property</th><th className="text-center px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Actions</th>
          </tr></thead>
          <tbody data-testid="hours-table-body">
            {items.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-dim text-sm">No entries yet.</td></tr>}
            {items.map((r) => (
              <tr key={r.id} data-testid={`hours-row-${r.id}`} className="tbl-row">
                <td className="px-4 py-3 text-dim">{r.date}</td>
                <td className="px-4 py-3">{r.staff_member_name}</td>
                <td className="px-4 py-3 text-dim text-xs">{r.clock_in_time} → {r.clock_out_time}</td>
                <td className="px-4 py-3 text-right tabular-nums">{r.total_hours}</td>
                <td className="px-4 py-3 text-dim">{r.property_name || "—"}</td>
                <td className="px-4 py-3 text-center"><span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ color: STATUS_COLOR[r.status], borderColor: STATUS_COLOR[r.status] + "55" }}>{r.status}</span></td>
                <td className="px-4 py-3 text-right text-xs">
                  {r.status === "Draft" && r.staff_member_id === user.id && <button onClick={() => doAction(r, "submit")} data-testid={`submit-${r.id}`} className="text-[#7AB8FF] hover:text-white">Submit</button>}
                  {isMgr && r.status === "Submitted" && (<>
                    <button onClick={() => doAction(r, "approve")} data-testid={`approve-hrs-${r.id}`} className="text-[#5BD1A8] hover:text-white mr-2">Approve</button>
                    <button onClick={() => { const reason = window.prompt("Rejection reason?"); if (reason) doAction(r, "reject", { reason }); }} data-testid={`reject-hrs-${r.id}`} className="text-[#E05A50] hover:text-white">Reject</button>
                  </>)}
                  {r.status === "Rejected" && r.rejection_reason && <span className="text-[10px] text-dim">{r.rejection_reason}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <HoursModal isMgr={isMgr} users={users} properties={properties} selfId={user.id} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}

function HoursModal({ isMgr, users, properties, selfId, onClose, onSaved }) {
  const [d, setD] = useState({ staff_member_id: selfId, date: new Date().toISOString().slice(0, 10), clock_in_time: "09:00", clock_out_time: "17:00", property_id: "", notes: "" });
  const save = async () => {
    try { await api.post("/staff/hours", d); toast.success("Hours logged as Draft"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="hours-modal">
        <div className="font-display text-lg">Log hours</div>
        {isMgr && (
          <Select value={d.staff_member_id} onValueChange={(v) => setD({ ...d, staff_member_id: v })}>
            <SelectTrigger className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} data-testid="hours-date" className="bg-transparent border-[#22252F]" />
        <div className="grid grid-cols-2 gap-2">
          <Input type="time" value={d.clock_in_time} onChange={(e) => setD({ ...d, clock_in_time: e.target.value })} data-testid="hours-in" className="bg-transparent border-[#22252F]" />
          <Input type="time" value={d.clock_out_time} onChange={(e) => setD({ ...d, clock_out_time: e.target.value })} data-testid="hours-out" className="bg-transparent border-[#22252F]" />
        </div>
        <Select value={d.property_id || "__none__"} onValueChange={(v) => setD({ ...d, property_id: v === "__none__" ? "" : v })}>
          <SelectTrigger data-testid="hours-property" className="bg-transparent border-[#22252F]"><SelectValue placeholder="Property" /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
            <SelectItem value="__none__">— None —</SelectItem>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Notes" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} className="bg-transparent border-[#22252F]" />
        <div className="flex justify-end gap-2"><button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button><button onClick={save} data-testid="hours-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Save draft</button></div>
      </div>
    </div>
  );
}
