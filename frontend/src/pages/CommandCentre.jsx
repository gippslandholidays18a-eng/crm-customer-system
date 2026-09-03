import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { RefreshCw, ArrowRight, AlertTriangle, CalendarClock, Waves, MailOpen, Clock } from "lucide-react";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${DOW[d.getDay()]} ${d.getDate()}`;
}

export default function CommandCentre() {
  const [data, setData] = useState(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.get("/command-centre").then((r) => { if (!cancelled) setData(r.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [version]);

  useEffect(() => {
    const t = setInterval(refresh, 120000); // 2 min
    return () => clearInterval(t);
  }, [refresh]);

  if (!data) return <div className="text-dim">Loading…</div>;

  const isOverdue = (d) => d && d < data.today;
  const isDueToday = (d) => d === data.today;

  return (
    <div className="space-y-6" data-testid="command-centre-page">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Operations</div>
          <h1 className="font-display text-3xl mt-1">Command centre</h1>
          <p className="text-xs text-dim mt-1">Refreshed {new Date(data.refreshed_at).toLocaleTimeString()} · auto every 2 min</p>
        </div>
        <button onClick={refresh} data-testid="refresh-btn" className="text-dim hover:text-white inline-flex items-center gap-1 text-xs"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>
      </header>

      {/* Stream 1: 7-day view */}
      <section className="surface rounded-md p-5" data-testid="stream-week">
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#D9A05B]" />
            <div className="font-display text-base">Check-ins & check-outs — next 7 days</div>
          </div>
          <Link to="/reservations" className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></Link>
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
              <tr>
                <th className="text-left py-2 pr-4">Date</th>
                <th className="text-right py-2 px-2">In</th>
                <th className="text-right py-2 px-2">Out</th>
                <th className="text-left py-2 pl-4">Properties</th>
              </tr>
            </thead>
            <tbody>
              {data.week.map((d) => {
                const total = d.check_ins + d.check_outs;
                const parts = [];
                Object.entries(d.check_in_by_property).forEach(([n, c]) => parts.push(`${n} (${c} in)`));
                Object.entries(d.check_out_by_property).forEach(([n, c]) => parts.push(`${n} (${c} out)`));
                return (
                  <tr key={d.date} data-testid={`week-row-${d.date}`} className="border-t border-[#1A1D24]">
                    <td className="py-2 pr-4 text-white">{fmtDay(d.date)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-[#5BD1A8]">{d.check_ins || "—"}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-[#7AB8FF]">{d.check_outs || "—"}</td>
                    <td className="py-2 pl-4 text-xs text-dim truncate max-w-[420px]">{total === 0 ? "—" : parts.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Stream 2: overdue/today tasks */}
        <StreamCard title="Tasks needing attention" icon={<AlertTriangle className="w-4 h-4 text-[#E05A50]" />}
                    count={data.tasks.length} link="/tasks" testid="stream-tasks">
          {data.tasks.length === 0 ? <Empty /> : data.tasks.map((t) => (
            <Link key={t.id} to={`/tasks?status=${t.status}`} data-testid={`task-${t.id}`}
                  className="block py-2 border-t border-[#1A1D24] hover:bg-[#14161D] px-1 rounded">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white truncate flex-1">{t.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                  isOverdue(t.due_date) ? "text-[#E05A50] border-[#E05A50]/40" :
                  isDueToday(t.due_date) ? "text-[#D9A05B] border-[#D9A05B]/40" : "text-dim border-[#22252F]"
                }`}>{isOverdue(t.due_date) ? "Overdue" : isDueToday(t.due_date) ? "Due today" : t.due_date}</span>
              </div>
              <div className="text-[11px] text-dim">{t.property_name || "—"} · {t.status}</div>
            </Link>
          ))}
        </StreamCard>

        {/* Stream 3: payments — Stage 9 placeholder */}
        <StreamCard title="Payment follow-ups" icon={<Clock className="w-4 h-4 text-dim" />} count={0} testid="stream-payments">
          <div className="text-xs text-dim italic py-4 text-center">
            No payment follow-ups tracked yet.
            <div className="text-[11px] mt-1 opacity-70">Coming in Stage 9.</div>
          </div>
        </StreamCard>

        {/* Stream 4: guest follow-ups */}
        <StreamCard title="Guest follow-ups (48h+ since reply)" icon={<Clock className="w-4 h-4 text-[#D9A05B]" />}
                    count={data.guest_followups.length} link="/inbox" testid="stream-followups">
          {data.guest_followups.length === 0 ? <Empty /> : data.guest_followups.map((m) => (
            <Link key={m.id} to="/inbox" className="block py-2 border-t border-[#1A1D24] hover:bg-[#14161D] px-1 rounded">
              <div className="text-sm text-white truncate">{m.from_guest_name || m.from_guest_email}</div>
              <div className="text-[11px] text-dim truncate">{m.subject} · {m.property_name || "—"}</div>
            </Link>
          ))}
        </StreamCard>

        {/* Stream 5: unread messages */}
        <StreamCard title="Unread messages" icon={<MailOpen className="w-4 h-4 text-[#7AB8FF]" />}
                    count={data.unread_messages.length} link="/inbox" testid="stream-unread">
          {data.unread_messages.length === 0 ? <Empty /> : data.unread_messages.map((m) => (
            <Link key={m.id} to="/inbox" className="block py-2 border-t border-[#1A1D24] hover:bg-[#14161D] px-1 rounded">
              <div className="text-sm text-white truncate">{m.from_guest_name || m.from_guest_email}</div>
              <div className="text-[11px] text-dim truncate">{m.subject}</div>
              <div className="text-[10px] text-dim truncate">{m.preview}</div>
            </Link>
          ))}
        </StreamCard>

        {/* Stream 6: paddle today */}
        <StreamCard title="Paddle & Pedal — today" icon={<Waves className="w-4 h-4 text-[#5BD1A8]" />}
                    count={data.paddle_today.length} link="/paddle" testid="stream-paddle">
          {data.paddle_today.length === 0 ? <Empty /> : data.paddle_today.map((b) => (
            <div key={b.id} className="py-2 border-t border-[#1A1D24]">
              <div className="text-sm text-white truncate">{b.guest_name} · {b.activity_type}</div>
              <div className="text-[11px] text-dim">{b.booking_time} · {b.duration_hours}h · {b.property_name || "—"}</div>
            </div>
          ))}
        </StreamCard>
      </div>
    </div>
  );
}

function StreamCard({ title, icon, count, link, testid, children }) {
  return (
    <section data-testid={testid} className="surface rounded-md p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2">
          {icon}
          <span className="font-display text-base">{title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1A1D24] text-dim tabular-nums">{count}</span>
        </div>
        {link && <Link to={link} className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></Link>}
      </div>
      <div className="max-h-64 overflow-y-auto -mx-1 px-1">{children}</div>
    </section>
  );
}

function Empty() {
  return <div className="text-xs text-dim italic py-4 text-center">Nothing here — nice.</div>;
}
