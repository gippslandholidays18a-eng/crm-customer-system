import { useCallback, useEffect, useMemo, useState } from "react";
import { api, API } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Download, Upload, X } from "lucide-react";
import { toast } from "sonner";
import PricingIntelligence from "@/components/PricingIntelligence";

const SEASONS = ["peak", "shoulder", "off", "holiday"];
const SEASON_COLOR = {
  peak: "#E05A50", shoulder: "#D9A05B", off: "#7AB8FF", holiday: "#B486E0",
};

const fmt = (d) => d.toISOString().slice(0, 10);
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

export default function Pricing() {
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState("all");
  const [cursor, setCursor] = useState(new Date());
  const [cells, setCells] = useState([]);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const range = useMemo(() => ({
    start: fmt(startOfMonth(cursor)),
    end: fmt(endOfMonth(cursor)),
  }), [cursor]);

  useEffect(() => {
    api.get("/properties").then((r) => setProperties(r.data.items || []));
  }, []);

  useEffect(() => {
    const params = { date_from: range.start, date_to: range.end };
    if (propertyId !== "all") params.property_id = propertyId;
    api.get("/pricing", { params }).then((r) => setCells(r.data.items || []));
  }, [range.start, range.end, propertyId, version]);

  const byKey = useMemo(() => {
    const m = {};
    cells.forEach((c) => { m[`${c.property_id}::${c.date}`] = c; });
    return m;
  }, [cells]);

  const propsToShow = propertyId === "all" ? properties : properties.filter((p) => p.id === propertyId);

  const days = useMemo(() => {
    const s = new Date(range.start + "T00:00:00");
    const e = new Date(range.end + "T00:00:00");
    const out = [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
  }, [range.start, range.end]);

  const exportCsv = () => {
    const url = `${API}/pricing/export.csv?date_from=${range.start}&date_to=${range.end}${propertyId !== "all" ? `&property_id=${propertyId}` : ""}`;
    const token = localStorage.getItem("sb_token");
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.text()).then((t) => {
        const blob = new Blob([t], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `pricing-${range.start}.csv`; a.click();
      });
  };

  return (
    <div className="space-y-6" data-testid="pricing-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Revenue</div>
          <h1 className="font-display text-3xl mt-1">Seasonal pricing</h1>
          <p className="text-xs text-dim mt-1">Base × multiplier = final nightly rate. Season auto-suggested; override any cell.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setImporting(true)} data-testid="import-btn" className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md hover:border-[#3A3F4C]">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button onClick={exportCsv} data-testid="export-btn" className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md hover:border-[#3A3F4C]">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </header>

      <div className="flex gap-2 items-center flex-wrap">
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="text-dim hover:text-white"><ChevronLeft className="w-4 h-4" /></button>
        <div className="font-display text-lg" data-testid="pricing-cursor">
          {cursor.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="text-dim hover:text-white"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={() => setCursor(new Date())} className="text-[11px] text-dim hover:text-white">Today</button>
        <div className="ml-auto flex gap-3 items-center">
          {SEASONS.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-[10px] uppercase text-dim">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEASON_COLOR[s] }} /> {s}
            </span>
          ))}
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger data-testid="filter-property" className="w-56 bg-transparent border-[#22252F] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-80">
              <SelectItem value="all">All properties</SelectItem>
              {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="surface rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#0E1015] text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
              <tr>
                <th className="text-left px-3 py-2 sticky left-0 bg-[#0E1015] z-10">Property</th>
                {days.map((d) => (
                  <th key={d.toISOString()} className="px-2 py-2 min-w-[64px]">
                    <div className="tabular-nums text-white">{d.getDate()}</div>
                    <div className="text-[9px] text-dim">{["Su","Mo","Tu","We","Th","Fr","Sa"][d.getDay()]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-testid="pricing-grid">
              {propsToShow.length === 0 && <tr><td colSpan={days.length + 1} className="p-6 text-center text-dim">No properties.</td></tr>}
              {propsToShow.map((p) => (
                <tr key={p.id} className="border-t border-[#1A1D24]">
                  <td className="px-3 py-2 sticky left-0 bg-[#0B0C11] text-xs text-white z-10 max-w-[180px] truncate">{p.name}</td>
                  {days.map((d) => {
                    const key = `${p.id}::${fmt(d)}`;
                    const c = byKey[key];
                    const bg = c ? SEASON_COLOR[c.season] + "22" : "transparent";
                    return (
                      <td key={key} className="px-1 py-1 text-center" style={{ backgroundColor: bg }}>
                        <button data-testid={`cell-${p.id}-${fmt(d)}`}
                                onClick={() => setEditing({ property: p, date: fmt(d), existing: c })}
                                className="w-full h-full text-[11px] leading-tight hover:bg-white/5 rounded px-1 py-1">
                          {c ? (
                            <>
                              <div className="tabular-nums text-white">${c.final_nightly_rate.toFixed(0)}</div>
                              <div className="text-[9px] text-dim tabular-nums">×{c.multiplier}</div>
                            </>
                          ) : (
                            <div className="text-dim text-[10px]">—</div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <EditModal editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}

      <PricingIntelligence properties={properties} refreshKey={version} />
    </div>
  );
}

function EditModal({ editing, onClose, onSaved }) {
  const { property, date, existing } = editing;
  const [form, setForm] = useState({
    base_nightly_rate: existing?.base_nightly_rate ?? 180,
    multiplier: existing?.multiplier ?? 1.0,
    season: existing?.season || "",
    notes: existing?.notes || "",
  });
  const save = async () => {
    try {
      const body = {
        base_nightly_rate: Number(form.base_nightly_rate),
        multiplier: Number(form.multiplier),
        notes: form.notes,
      };
      if (form.season) body.season = form.season;
      await api.put(`/pricing/${property.id}/${date}`, body);
      toast.success("Saved");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const finalRate = (Number(form.base_nightly_rate || 0) * Number(form.multiplier || 0)).toFixed(2);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="pricing-modal">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-dim">{property.name}</div>
          <div className="font-display text-lg mt-0.5">{date}</div>
        </div>
        <label className="text-xs text-dim block">Base nightly rate ($)</label>
        <Input type="number" step="1" value={form.base_nightly_rate} onChange={(e) => setForm({ ...form, base_nightly_rate: e.target.value })} data-testid="edit-base" className="bg-transparent border-[#22252F]" />
        <label className="text-xs text-dim block">Multiplier</label>
        <Input type="number" step="0.05" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })} data-testid="edit-mult" className="bg-transparent border-[#22252F]" />
        <div className="text-xs text-dim">Final rate: <span className="text-white tabular-nums">${finalRate}</span></div>
        <label className="text-xs text-dim block">Season</label>
        <Select value={form.season || "__auto__"} onValueChange={(v) => setForm({ ...form, season: v === "__auto__" ? "" : v })}>
          <SelectTrigger data-testid="edit-season" className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
            <SelectItem value="__auto__">Auto (from date)</SelectItem>
            {SEASONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="text-xs text-dim block">Notes</label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="bg-transparent border-[#22252F]" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button>
          <button onClick={save} data-testid="pricing-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Save</button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onDone }) {
  const [text, setText] = useState("date,property_name,base_nightly_rate,multiplier,season,notes\n");
  const [result, setResult] = useState(null);
  const submit = async () => {
    try {
      const r = await api.post("/pricing/bulk-import", { csv_text: text });
      setResult(r.data);
      toast.success(`${r.data.written} cells written`);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()} data-testid="pricing-import">
        <div className="flex justify-between items-center">
          <div className="font-display text-lg">Bulk import pricing (CSV)</div>
          <button onClick={onClose} className="text-dim hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-xs text-dim">Columns: <code>date, property_name (or property_id), base_nightly_rate, multiplier, season, notes</code></div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} data-testid="import-text" className="bg-transparent border-[#22252F] font-mono text-xs" />
        {result && (
          <div className="text-xs">
            <div className="text-white">Written: <span className="tabular-nums">{result.written}</span> / {result.total_rows}</div>
            {result.errors?.length > 0 && <ul className="text-[#E05A50] list-disc pl-5 mt-1">{result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onDone} className="text-sm text-dim px-3 py-2">Done</button>
          <button onClick={submit} data-testid="import-submit" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Import</button>
        </div>
      </div>
    </div>
  );
}
