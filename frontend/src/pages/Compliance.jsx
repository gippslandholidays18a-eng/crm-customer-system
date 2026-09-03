import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  SCHEDULE_STATUSES, KIND_LABELS, fmtDate, daysUntil, cadenceLabel,
} from "@/lib/schedules";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck, Sparkles, AlertTriangle, Clock, CheckCircle2,
  Search, X, RefreshCw, Plus,
} from "lucide-react";
import { toast } from "sonner";

export default function Compliance() {
  const { user } = useAuth();
  const isMgr = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [properties, setProperties] = useState([]);
  const [filters, setFilters] = useState({ kind: "", property_id: "", status: "", q: "" });
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api.get("/properties").then((r) => setProperties(r.data.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = {};
    if (filters.kind) params.kind = filters.kind;
    if (filters.property_id) params.property_id = filters.property_id;
    if (filters.status) params.status = filters.status;
    api.get("/schedules", { params })
      .then((r) => {
        if (cancelled) return;
        setItems(r.data.items || []);
        setSummary(r.data.summary || null);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [version, filters.kind, filters.property_id, filters.status]);

  const filtered = useMemo(() => {
    if (!filters.q.trim()) return items;
    const q = filters.q.toLowerCase();
    return items.filter((i) =>
      (i.label || "").toLowerCase().includes(q) ||
      (i.property_name || "").toLowerCase().includes(q) ||
      (i.subtype || "").toLowerCase().includes(q)
    );
  }, [items, filters.q]);

  const markDone = async (item) => {
    if (!window.confirm(`Mark "${item.label}" done for ${item.property_name}?`)) return;
    setBusyId(item.id);
    try {
      await api.post(`/schedules/${item.id}/mark-done`);
      toast.success("Marked done · next due bumped");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not mark done");
    } finally {
      setBusyId(null);
    }
  };

  const reseedDefaults = async () => {
    if (!filters.property_id) {
      toast.message("Pick a property first");
      return;
    }
    try {
      const r = await api.post(`/schedules/seed-defaults?property_id=${filters.property_id}`);
      toast.success(`Seeded ${r.data.inserted} item(s) · ${r.data.skipped} already existed`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not seed defaults");
    }
  };

  return (
    <div className="space-y-8" data-testid="compliance-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Operations</div>
          <h1 className="font-display text-3xl tracking-tight mt-1">Compliance &amp; housekeeping</h1>
          <p className="text-sm text-dim mt-2 max-w-2xl">
            Track recurring obligations and cleaning rotations across every property. Items advance
            automatically when their linked task is marked done; the schedule auto-creates a task
            inside the lead window so nothing falls through.
          </p>
        </div>
        <div className="flex gap-2">
          {isMgr && (
            <button
              onClick={reseedDefaults}
              data-testid="reseed-defaults"
              className="inline-flex items-center gap-2 text-xs border border-[#22252F] hover:border-[#3A3F4C] text-dim hover:text-white px-3 py-2 rounded-md"
            >
              <Plus className="w-3.5 h-3.5" /> Seed defaults for selected property
            </button>
          )}
          <button
            onClick={refresh}
            data-testid="refresh"
            className="inline-flex items-center gap-2 text-xs border border-[#22252F] hover:border-[#3A3F4C] text-dim hover:text-white px-3 py-2 rounded-md"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Sync auto-tasks
          </button>
        </div>
      </header>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="schedule-summary">
          <Tile testid="sum-total"      label="Total"          value={summary.total} />
          <Tile testid="sum-compliance" label="Compliance"     value={summary.by_kind.compliance} accent="#7AB8FF" icon={<ShieldCheck className="w-3.5 h-3.5" />} />
          <Tile testid="sum-housekeeping" label="Housekeeping" value={summary.by_kind.housekeeping} accent="#5BD1A8" icon={<Sparkles className="w-3.5 h-3.5" />} />
          <Tile testid="sum-overdue"    label="Overdue"        value={summary.by_status.overdue} accent="#E05A50" icon={<AlertTriangle className="w-3.5 h-3.5" />} />
          <Tile testid="sum-due-soon"   label="Due soon"       value={summary.by_status.due_soon} accent="#D9A05B" icon={<Clock className="w-3.5 h-3.5" />} />
        </div>
      )}

      <div className="surface rounded-md p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" data-testid="schedule-filters">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-dim pointer-events-none" />
          <Input
            placeholder="Search label, property…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            data-testid="filter-search"
            className="pl-8 bg-transparent border-[#22252F] text-sm"
          />
        </div>
        <FilterSelect testid="filter-kind" placeholder="Kind" value={filters.kind}
          onChange={(v) => setFilters({ ...filters, kind: v })}
          options={[{ value: "compliance", label: "Compliance" }, { value: "housekeeping", label: "Housekeeping" }]} />
        <FilterSelect testid="filter-status" placeholder="Status" value={filters.status}
          onChange={(v) => setFilters({ ...filters, status: v })}
          options={SCHEDULE_STATUSES.map((s) => ({ value: s.key, label: s.label }))} />
        <FilterSelect testid="filter-property" placeholder="Property" value={filters.property_id}
          onChange={(v) => setFilters({ ...filters, property_id: v })}
          options={properties.map((p) => ({ value: p.id, label: p.name }))} />
      </div>

      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() => setFilters({ kind: "", property_id: "", status: "", q: "" })}
          data-testid="filter-clear"
          className="inline-flex items-center gap-1 text-dim hover:text-white"
        >
          <X className="w-3 h-3" /> Clear
        </button>
        <span className="ml-auto text-dim">{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
      </div>

      <div className="surface rounded-md overflow-hidden">
        {loading ? (
          <div className="p-8 text-dim text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-dim text-sm" data-testid="schedule-empty">
            No schedule items match these filters.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#0E1015]">
              <tr className="text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
                <th className="text-left px-4 py-3 font-semibold">Item</th>
                <th className="text-left px-4 py-3 font-semibold">Property</th>
                <th className="text-center px-4 py-3 font-semibold">Cadence</th>
                <th className="text-left px-4 py-3 font-semibold">Last done</th>
                <th className="text-left px-4 py-3 font-semibold">Next due</th>
                <th className="text-center px-4 py-3 font-semibold">Status</th>
                {isMgr && <th className="text-right px-4 py-3 font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody data-testid="schedule-table-body">
              {filtered.map((it) => {
                const st = SCHEDULE_STATUSES.find((s) => s.key === it.status) || SCHEDULE_STATUSES[2];
                const dleft = daysUntil(it.next_due_at);
                return (
                  <tr key={it.id} data-testid={`schedule-row-${it.id}`} className="tbl-row">
                    <td className="px-4 py-3">
                      <div className="text-white flex items-center gap-2">
                        {it.kind === "compliance" ? <ShieldCheck className="w-3.5 h-3.5 text-[#7AB8FF]" /> : <Sparkles className="w-3.5 h-3.5 text-[#5BD1A8]" />}
                        {it.label}
                      </div>
                      <div className="text-[10px] text-dim mt-0.5">{KIND_LABELS[it.kind]} · {it.subtype}</div>
                      {it.linked_task_id && (
                        <div className="text-[10px] text-[#D9A05B] mt-0.5">↻ open task linked</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-dim">{it.property_name || "—"}</td>
                    <td className="px-4 py-3 text-center text-dim tabular-nums">{cadenceLabel(it.cadence_days)}</td>
                    <td className="px-4 py-3 text-dim text-xs">
                      {fmtDate(it.last_done_at)}
                      {it.last_done_by_name && <div className="text-[10px] opacity-70">by {it.last_done_by_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className={dleft != null && dleft < 0 ? "text-[#E05A50]" : dleft != null && dleft <= 30 ? "text-[#D9A05B]" : "text-dim"}>
                        {fmtDate(it.next_due_at)}
                      </div>
                      {dleft != null && (
                        <div className="text-[10px] opacity-70">
                          {dleft < 0 ? `${Math.abs(dleft)}d overdue` : dleft === 0 ? "today" : `in ${dleft}d`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="text-[11px] inline-block px-2 py-0.5 rounded-full border"
                        style={{ color: st.color, borderColor: st.color + "55" }}
                        data-testid={`status-pill-${it.id}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    {isMgr && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => markDone(it)}
                          disabled={busyId === it.id}
                          data-testid={`mark-done-${it.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#5BD1A8] hover:text-white disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Mark done
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent, icon, testid }) {
  return (
    <div className="surface rounded-md p-3" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="font-display text-2xl mt-1 tabular-nums" style={accent ? { color: accent } : {}}>
        {value ?? 0}
      </div>
    </div>
  );
}

function FilterSelect({ testid, value, onChange, options, placeholder }) {
  return (
    <Select value={value || "__all__"} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger data-testid={testid} className="bg-transparent border-[#22252F] text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
        <SelectItem value="__all__">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
