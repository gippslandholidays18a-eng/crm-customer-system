import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, API } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function StaffProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [ical, setIcal] = useState(null);

  const load = () => {
    api.get(`/staff/${id}/profile`).then((r) => setData(r.data)).catch(() => {});
    api.get(`/staff/${id}/ical-info`).then((r) => setIcal(r.data)).catch(() => {});
  };
  useEffect(load, [id]);

  const rotate = async () => {
    try { const r = await api.post(`/staff/${id}/rotate-ical-token`); setIcal(r.data); toast.success("Token rotated"); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  if (!data) return <div className="text-dim">Loading…</div>;
  const u = data.user;
  const feedUrl = ical ? `${API.replace(/\/api$/, "")}${ical.path}` : "";

  return (
    <div className="space-y-6" data-testid="staff-profile-page">
      <header>
        <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Team member</div>
        <h1 className="font-display text-3xl mt-1">{u.name}</h1>
        <div className="text-sm text-dim mt-1">{u.email} · <span className="uppercase tracking-[0.15em] text-[10px]">{u.role}</span></div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card label="Approved hours (this month)" value={`${data.month_hours_approved}h`} />
        <Card label="Open tasks" value={data.open_tasks_count} />
        <Card label="Shifts this week" value={data.shifts_this_week.length} />
      </div>

      <div className="surface rounded-md p-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-dim mb-2">Assigned properties</div>
        <div className="flex flex-wrap gap-2">
          {(data.assigned_property_names || []).length === 0 && <div className="text-xs text-dim italic">None</div>}
          {(data.assigned_property_names || []).map((p) => <span key={p} className="text-xs px-2 py-1 rounded-full bg-[#1A1D24] border border-[#22252F]">{p}</span>)}
        </div>
      </div>

      {data.pending_timeoff.length > 0 && (
        <div className="surface rounded-md p-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim mb-2">Time-off</div>
          <div className="space-y-1">
            {data.pending_timeoff.map((t) => (
              <div key={t.id} className="text-xs flex gap-3 border-t border-[#1A1D24] pt-1.5">
                <span className="text-white">{t.leave_type}</span>
                <span className="text-dim">{t.start_date} → {t.end_date}</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border" style={{ color: t.status === "Approved" ? "#5BD1A8" : t.status === "Declined" ? "#E05A50" : "#D9A05B", borderColor: "currentColor" }}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ical && (
        <div className="surface rounded-md p-4" data-testid="ical-panel">
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim mb-2">iCal subscription</div>
          <div className="flex gap-2 items-center">
            <input readOnly value={feedUrl} data-testid="ical-url" className="flex-1 bg-transparent border border-[#22252F] rounded-md px-2 py-1.5 text-xs font-mono text-dim" />
            <button onClick={() => { navigator.clipboard.writeText(feedUrl); toast.success("Copied"); }} data-testid="ical-copy" className="text-dim hover:text-white p-2"><Copy className="w-4 h-4" /></button>
            {user?.role === "admin" && <button onClick={rotate} data-testid="ical-rotate" className="text-dim hover:text-white p-2" title="Rotate token"><RefreshCw className="w-4 h-4" /></button>}
          </div>
          <div className="text-[11px] text-dim mt-2">
            Copy this URL and paste it into Google Calendar under Other Calendars → From URL, or into Outlook under Add Calendar → From Internet.
          </div>
          {data.open_tasks_count > 0 && (
            <Link to={`/tasks?assignee_id=${id}`} className="text-[11px] text-[#7AB8FF] hover:text-white mt-3 inline-block">View {data.open_tasks_count} open tasks →</Link>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }) {
  return (
    <div className="surface rounded-md p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim">{label}</div>
      <div className="font-display text-2xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}
