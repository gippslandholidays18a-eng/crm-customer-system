import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea, Legend } from "recharts";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Check, X, RefreshCw, Zap } from "lucide-react";
import { toast } from "sonner";

const BUCKET_COLOR = {
  Critical: "#E05A50", Low: "#D9A05B", Healthy: "#5BD1A8", Peak: "#7AB8FF",
};
const REC_ICON = {
  REDUCE_RATE: TrendingDown,
  MAINTAIN_RATE: Minus,
  INCREASE_RATE: TrendingUp,
};
const REC_COLOR = {
  REDUCE_RATE: "#E05A50",
  MAINTAIN_RATE: "#8F95A3",
  INCREASE_RATE: "#5BD1A8",
};
const SEV_LABEL = { critical: "Critical", warning: "Opportunity", success: "Peak", info: "Standard" };

const LINE_COLORS = [
  "#D9A05B", "#5BD1A8", "#7AB8FF", "#B486E0", "#E05A50",
  "#E0904E", "#16B5C6", "#F2C94C", "#9B59B6", "#3498DB",
  "#F26D5B", "#7ED4A6", "#5BA9F9", "#C7A9E8", "#F0B36C",
];

export default function PricingIntelligence({ properties, refreshKey }) {
  const [forecast, setForecast] = useState({ items: [], summary: null });
  const [elasticity, setElasticity] = useState([]);
  const [recs, setRecs] = useState({ items: [], summary: null });
  const [filterProperty, setFilterProperty] = useState("all");
  const [filterRec, setFilterRec] = useState("all");
  const [filterSev, setFilterSev] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    Promise.all([
      api.get("/pricing/occupancy-forecast", { params: { days_ahead: 30 } }),
      api.get("/pricing/elasticity-summary"),
      api.get("/pricing/recommendations", { params: { days_ahead: 30 } }),
    ]).then(([f, e, r]) => {
      setForecast(f.data);
      setElasticity(e.data.items || []);
      setRecs(r.data);
    }).catch(() => {});
  }, [version, refreshKey]);

  const runRefresh = async () => {
    setRefreshing(true);
    try {
      await api.post("/pricing/recommendations/refresh");
      toast.success("Forecast + recommendations refreshed");
      refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setRefreshing(false); }
  };

  const runCorrelation = async () => {
    setRefreshing(true);
    try {
      await api.post("/pricing/rate-correlation/refresh");
      toast.success("Historical correlation refreshed");
      refresh();
    } catch (e) { toast.error("Failed"); }
    finally { setRefreshing(false); }
  };

  const propNameById = useMemo(() => {
    const m = {};
    (properties || []).forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [properties]);

  // Chart data: pivot forecast into { date, propId: pct, ... }
  const chartData = useMemo(() => {
    const byDate = {};
    forecast.items.forEach((r) => {
      const key = r.date;
      if (!byDate[key]) byDate[key] = { date: key };
      byDate[key][r.property_id] = r.occupancy_pct;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [forecast.items]);

  const chartProperties = useMemo(() => {
    if (filterProperty !== "all") return properties.filter((p) => p.id === filterProperty);
    return properties.slice(0, 10);  // cap for readability
  }, [filterProperty, properties]);

  const filteredRecs = useMemo(() => {
    let list = [...recs.items];
    if (filterProperty !== "all") list = list.filter((r) => r.property_id === filterProperty);
    if (filterRec !== "all") list = list.filter((r) => r.recommendation === filterRec);
    if (filterSev !== "all") list = list.filter((r) => r.alert_severity === filterSev);
    if (sortBy === "severity") {
      const order = { critical: 0, warning: 1, success: 2, info: 3, none: 4 };
      list.sort((a, b) => (order[a.alert_severity] ?? 5) - (order[b.alert_severity] ?? 5));
    } else {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }
    return list;
  }, [recs.items, filterProperty, filterRec, filterSev, sortBy]);

  const applyRec = async (r) => {
    if (!window.confirm(`Apply ${r.adjustment_pct}% adjustment → $${r.suggested_rate.toFixed(0)} on ${r.date}?`)) return;
    try {
      await api.post(`/pricing/recommendations/${r.id}/apply`);
      toast.success("Applied to pricing calendar");
      refresh();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const dismissRec = async (r) => {
    try {
      await api.post(`/pricing/recommendations/${r.id}/dismiss`);
      toast.success("Dismissed");
      refresh();
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="pricing-intelligence">
      {/* Section 1: 30-Day Forecast */}
      <section className="surface rounded-md p-5" data-testid="forecast-card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Revenue intelligence</div>
            <div className="font-display text-lg">30-day occupancy forecast</div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterProperty} onValueChange={setFilterProperty}>
              <SelectTrigger data-testid="forecast-property" className="w-56 bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-80">
                <SelectItem value="all">All properties (first 10)</SelectItem>
                {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <button onClick={runRefresh} disabled={refreshing} data-testid="refresh-recs"
                    className="inline-flex items-center gap-1 text-[11px] border border-[#22252F] rounded-md px-3 py-1.5 text-dim hover:text-white disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh forecast
            </button>
            <button onClick={runCorrelation} disabled={refreshing} data-testid="refresh-corr"
                    className="inline-flex items-center gap-1 text-[11px] border border-[#22252F] rounded-md px-3 py-1.5 text-dim hover:text-white disabled:opacity-40">
              <Zap className="w-3.5 h-3.5" /> Recompute history
            </button>
          </div>
        </div>

        {forecast.summary && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <Stat label="Avg occupancy · next 7 days" value={`${forecast.summary.avg_next_7_days}%`} />
            <Stat label="Peak date" value={forecast.summary.peak_date || "—"} sub={`${forecast.summary.peak_pct}%`} />
            <Stat label="Critical windows" value={forecast.summary.critical_count} accent="#E05A50" sub="properties below 30%" />
          </div>
        )}

        <div style={{ width: "100%", height: 300, minHeight: 300 }} data-testid="forecast-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 4 }}>
              <CartesianGrid stroke="#1A1D24" strokeDasharray="3 3" />
              <ReferenceArea y1={0} y2={30} fill={BUCKET_COLOR.Critical} fillOpacity={0.06} />
              <ReferenceArea y1={30} y2={50} fill={BUCKET_COLOR.Low} fillOpacity={0.06} />
              <ReferenceArea y1={50} y2={80} fill={BUCKET_COLOR.Healthy} fillOpacity={0.06} />
              <ReferenceArea y1={80} y2={100} fill={BUCKET_COLOR.Peak} fillOpacity={0.06} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8F95A3" }} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: "#8F95A3" }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={{ backgroundColor: "#12141A", border: "1px solid #22252F", fontSize: 11 }}
                       labelStyle={{ color: "#F2F3F5" }}
                       formatter={(v, name) => [`${v}%`, propNameById[name] || name]} />
              {filterProperty === "all" && <Legend wrapperStyle={{ fontSize: 10 }} formatter={(name) => (propNameById[name] || name).slice(0, 22)} />}
              {chartProperties.map((p, i) => (
                <Line key={p.id} type="monotone" dataKey={p.id} stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={1.5} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Section 2: Rate recommendations */}
      <section className="surface rounded-md p-5" data-testid="recommendations-card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Actionable</div>
            <div className="font-display text-lg">Rate recommendations</div>
            {recs.summary && (
              <div className="text-[11px] text-dim mt-1">
                <span className="text-[#E05A50]">{recs.summary.critical}</span> critical ·
                <span className="text-[#D9A05B] ml-1">{recs.summary.warning}</span> opportunity ·
                <span className="text-[#5BD1A8] ml-1">{recs.summary.success}</span> peak lift
              </div>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <Select value={filterRec} onValueChange={setFilterRec}>
              <SelectTrigger data-testid="filter-rec" className="w-36 bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="REDUCE_RATE">Reduce</SelectItem>
                <SelectItem value="MAINTAIN_RATE">Maintain</SelectItem>
                <SelectItem value="INCREASE_RATE">Increase</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSev} onValueChange={setFilterSev}>
              <SelectTrigger data-testid="filter-sev" className="w-36 bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Opportunity</SelectItem>
                <SelectItem value="success">Peak</SelectItem>
                <SelectItem value="info">Standard</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-36 bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                <SelectItem value="date">Sort: date</SelectItem>
                <SelectItem value="severity">Sort: severity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 max-h-[520px] overflow-y-auto" data-testid="recs-list">
          {filteredRecs.length === 0 && <div className="text-xs text-dim text-center py-6 italic">No recommendations match your filter.</div>}
          {filteredRecs.slice(0, 200).map((r) => {
            const Icon = REC_ICON[r.recommendation] || Minus;
            const color = REC_COLOR[r.recommendation];
            return (
              <div key={r.id} data-testid={`rec-${r.id}`}
                   className="rounded-md border border-[#22252F] p-3 flex items-start gap-3 hover:border-[#3A3F4C]"
                   style={{ borderColor: r.alert_severity === "critical" ? "#E05A50" : undefined }}>
                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm text-white">{r.property_name}</span>
                    <span className="text-[10px] text-dim tabular-nums">{r.date}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums"
                          style={{ color: BUCKET_COLOR[r.occupancy_bucket], borderColor: BUCKET_COLOR[r.occupancy_bucket] + "55" }}>
                      {r.occupancy_forecast}% · {r.occupancy_bucket}
                    </span>
                    {r.alert_severity !== "none" && r.alert_severity !== "info" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{
                              color: r.alert_severity === "critical" ? "#E05A50" :
                                     r.alert_severity === "warning" ? "#D9A05B" : "#5BD1A8",
                              backgroundColor: (r.alert_severity === "critical" ? "#E05A50" :
                                                r.alert_severity === "warning" ? "#D9A05B" : "#5BD1A8") + "18",
                            }}>
                        {SEV_LABEL[r.alert_severity]}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-1">
                    <span className="text-dim">Current: </span>
                    <span className="text-white tabular-nums">${r.current_rate.toFixed(0)}</span>
                    <span className="text-dim mx-2">→</span>
                    <span className="tabular-nums font-medium" style={{ color }}>${r.suggested_rate.toFixed(0)}</span>
                    <span className="text-dim ml-2 tabular-nums">({r.adjustment_pct > 0 ? "+" : ""}{r.adjustment_pct}%)</span>
                  </div>
                  <div className="text-[11px] text-dim mt-1">{r.reasoning}</div>
                </div>
                {r.recommendation !== "MAINTAIN_RATE" && r.current_rate > 0 && (
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={() => applyRec(r)} data-testid={`apply-${r.id}`}
                            className="text-[10px] inline-flex items-center gap-1 border border-[#22252F] rounded px-2 py-1 text-dim hover:text-white hover:border-[#3A3F4C]">
                      <Check className="w-3 h-3" /> Apply
                    </button>
                    <button onClick={() => dismissRec(r)} data-testid={`dismiss-${r.id}`}
                            className="text-[10px] inline-flex items-center gap-1 text-dim hover:text-[#E05A50]">
                      <X className="w-3 h-3" /> Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 3: Elasticity insights */}
      <section className="surface rounded-md p-5" data-testid="elasticity-card">
        <div className="mb-3">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Historical performance</div>
          <div className="font-display text-lg">Elasticity insights</div>
          <div className="text-[11px] text-dim mt-1">Based on the last 52 weeks. More negative = more price-sensitive.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
              <tr>
                <th className="text-left py-2">Property</th>
                <th className="text-right py-2 px-2">Elasticity</th>
                <th className="text-right py-2 px-2">Confidence</th>
                <th className="text-left py-2 pl-4">Best-performing season</th>
                <th className="text-right py-2 px-2">Best avg rate</th>
                <th className="text-right py-2 px-2">Weeks</th>
              </tr>
            </thead>
            <tbody data-testid="elasticity-table">
              {elasticity.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-dim">No historical data yet.</td></tr>}
              {elasticity.map((e) => (
                <tr key={e.property_id} data-testid={`elast-${e.property_id}`} className="border-t border-[#1A1D24]">
                  <td className="py-2 text-white">{e.property_name}</td>
                  <td className="py-2 px-2 text-right tabular-nums" style={{ color: e.elasticity_score < 0 ? "#E05A50" : "#5BD1A8" }}>{e.elasticity_score.toFixed(2)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-dim">{Math.round((e.confidence || 0) * 100)}%</td>
                  <td className="py-2 pl-4 text-dim capitalize">{e.best_season || "—"}</td>
                  <td className="py-2 px-2 text-right tabular-nums">${(e.best_season_avg_rate || 0).toFixed(0)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-dim">{e.total_weeks_analyzed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {elasticity.some((e) => Math.abs(e.elasticity_score) > 1) && (
          <div className="mt-4 rounded-md border border-[#D9A05B]/40 bg-[#D9A05B]/5 px-3 py-2 text-xs text-[#D9A05B] inline-flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Some properties are highly price-sensitive. Consider dynamic rates during shoulder season to fill inventory.
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="rounded-md border border-[#22252F] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim">{label}</div>
      <div className="font-display text-xl mt-1 tabular-nums" style={accent ? { color: accent } : {}}>{value}</div>
      {sub && <div className="text-[10px] text-dim mt-1">{sub}</div>}
    </div>
  );
}
