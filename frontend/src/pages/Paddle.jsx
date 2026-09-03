import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Waves, Bike, Check, X } from "lucide-react";
import { toast } from "sonner";

const ACTIVITIES = ["Paddle", "Pedal"];
const STATUSES = ["confirmed", "completed", "cancelled"];
const STATUS_COLOR = { confirmed: "#7AB8FF", completed: "#5BD1A8", cancelled: "#E05A50" };

export default function Paddle() {
  const [items, setItems] = useState([]);
  const [properties, setProperties] = useState([]);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({
    start: "", end: "", activity_type: "all", status: "all",
  });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [selected, setSelected] = useState({});

  useEffect(() => {
    api.get("/properties").then((r) => setProperties(r.data.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (params[k] === "" || params[k] === "all") delete params[k]; });
    api.get("/paddle", { params }).then((r) => setItems(r.data.items || [])).catch(() => {});
  }, [filters, version]);

  const patch = async (b, updates) => {
    try { await api.put(`/paddle/${b.id}`, updates); toast.success("Updated"); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const del = async (b) => {
    if (!window.confirm("Delete booking?")) return;
    try { await api.delete(`/paddle/${b.id}`); toast.success("Deleted"); refresh(); }
    catch { toast.error("Failed"); }
  };
  const bulkComplete = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    if (!ids.length) { toast.error("Select bookings first"); return; }
    await Promise.all(ids.map((id) => api.put(`/paddle/${id}`, { status: "completed" })));
    toast.success(`${ids.length} marked completed`);
    setSelected({});
    refresh();
  };

  return (
    <div className="space-y-6" data-testid="paddle-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Activities</div>
          <h1 className="font-display text-3xl mt-1">Paddle & Pedal Paynesville</h1>
        </div>
        <div className="flex gap-2">
          {Object.values(selected).some(Boolean) && (
            <button onClick={bulkComplete} data-testid="bulk-complete-btn"
                    className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md">
              <Check className="w-4 h-4" /> Mark selected completed
            </button>
          )}
          <button onClick={() => setCreating(true)} data-testid="new-paddle-btn"
                  className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90">
            <Plus className="w-4 h-4" /> New booking
          </button>
        </div>
      </header>

      <div className="surface rounded-md p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Input type="date" value={filters.start} onChange={(e) => setFilters({ ...filters, start: e.target.value })} data-testid="filter-start" placeholder="Start" className="bg-transparent border-[#22252F] text-sm" />
        <Input type="date" value={filters.end} onChange={(e) => setFilters({ ...filters, end: e.target.value })} data-testid="filter-end" placeholder="End" className="bg-transparent border-[#22252F] text-sm" />
        <Select value={filters.activity_type} onValueChange={(v) => setFilters({ ...filters, activity_type: v })}>
          <SelectTrigger className="bg-transparent border-[#22252F] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
            <SelectItem value="all">All activities</SelectItem>
            {ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
          <SelectTrigger className="bg-transparent border-[#22252F] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="surface rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0E1015] text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
            <tr>
              <th className="text-left px-4 py-3"></th>
              <th className="text-left px-4 py-3">Date/Time</th>
              <th className="text-left px-4 py-3">Guest</th>
              <th className="text-left px-4 py-3">Activity</th>
              <th className="text-left px-4 py-3">Property</th>
              <th className="text-right px-4 py-3">Duration</th>
              <th className="text-right px-4 py-3">Price</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="paddle-table">
            {items.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-dim text-sm">No paddle bookings yet.</td></tr>}
            {items.map((b) => (
              <tr key={b.id} data-testid={`paddle-row-${b.id}`} className="tbl-row">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={!!selected[b.id]} onChange={(e) => setSelected({ ...selected, [b.id]: e.target.checked })} />
                </td>
                <td className="px-4 py-3 text-dim tabular-nums">{b.booking_date} · {b.booking_time}</td>
                <td className="px-4 py-3">
                  <div className="text-white">{b.guest_name}</div>
                  <div className="text-[11px] text-dim">{b.guest_email || "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1 text-xs">
                    {b.activity_type === "Paddle" ? <Waves className="w-3 h-3 text-[#5BD1A8]" /> : <Bike className="w-3 h-3 text-[#7AB8FF]" />}
                    {b.activity_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-dim">{b.property_name || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{b.duration_hours}h</td>
                <td className="px-4 py-3 text-right tabular-nums">${b.total_price.toFixed(2)}</td>
                <td className="px-4 py-3 text-center">
                  <Select value={b.status} onValueChange={(v) => patch(b, { status: v })}>
                    <SelectTrigger data-testid={`status-${b.id}`} className="bg-transparent border-[#22252F] h-7 text-xs w-32 mx-auto" style={{ color: STATUS_COLOR[b.status] }}><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => del(b)} data-testid={`delete-${b.id}`} className="text-dim hover:text-[#E05A50]"><X className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <PaddleModal properties={properties} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}

function PaddleModal({ properties, onClose, onSaved }) {
  const [d, setD] = useState({
    guest_name: "", guest_email: "", property_id: "",
    activity_type: "Paddle", booking_date: new Date().toISOString().slice(0, 10),
    booking_time: "09:00", duration_hours: 2, total_price: 85, notes: "",
  });
  const save = async () => {
    if (!d.guest_name.trim()) { toast.error("Guest name required"); return; }
    const body = { ...d, duration_hours: Number(d.duration_hours), total_price: Number(d.total_price) };
    if (!body.property_id) delete body.property_id;
    try { await api.post("/paddle", body); toast.success("Booking created"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="paddle-modal">
        <div className="font-display text-lg">New paddle/pedal booking</div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Guest name" value={d.guest_name} onChange={(e) => setD({ ...d, guest_name: e.target.value })} data-testid="pdl-name" className="bg-transparent border-[#22252F]" />
          <Input placeholder="Guest email" value={d.guest_email} onChange={(e) => setD({ ...d, guest_email: e.target.value })} className="bg-transparent border-[#22252F]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select value={d.activity_type} onValueChange={(v) => setD({ ...d, activity_type: v })}>
            <SelectTrigger data-testid="pdl-activity" className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white">{ACTIVITIES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={d.property_id || "__none__"} onValueChange={(v) => setD({ ...d, property_id: v === "__none__" ? "" : v })}>
            <SelectTrigger className="bg-transparent border-[#22252F]"><SelectValue placeholder="Property" /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
              <SelectItem value="__none__">— None —</SelectItem>
              {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={d.booking_date} onChange={(e) => setD({ ...d, booking_date: e.target.value })} data-testid="pdl-date" className="bg-transparent border-[#22252F]" />
          <Input type="time" value={d.booking_time} onChange={(e) => setD({ ...d, booking_time: e.target.value })} className="bg-transparent border-[#22252F]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" step="0.5" placeholder="Duration (h)" value={d.duration_hours} onChange={(e) => setD({ ...d, duration_hours: e.target.value })} className="bg-transparent border-[#22252F]" />
          <Input type="number" step="0.01" placeholder="Total price" value={d.total_price} onChange={(e) => setD({ ...d, total_price: e.target.value })} className="bg-transparent border-[#22252F]" />
        </div>
        <Textarea placeholder="Notes" value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} rows={2} className="bg-transparent border-[#22252F]" />
        <div className="flex justify-end gap-2"><button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button><button onClick={save} data-testid="pdl-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Save</button></div>
      </div>
    </div>
  );
}
