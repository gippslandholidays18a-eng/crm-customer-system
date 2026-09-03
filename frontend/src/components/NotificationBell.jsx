import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Bell, Mail, AlertTriangle, RefreshCcw, Clock, MessageSquare } from "lucide-react";

const TYPE_ICON = {
  inbox_message: Mail,
  urgent_message: AlertTriangle,
  overdue_task: Clock,
  turnover: RefreshCcw,
  quote_reply: MessageSquare,
};

function relTime(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const nav = useNavigate();
  const ref = useRef(null);

  const load = useCallback(() => {
    api.get("/notifications", { params: { limit: 15 } })
      .then((r) => { setItems(r.data.items || []); setUnread(r.data.unread_count || 0); })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const openItem = async (n) => {
    setOpen(false);
    try { await api.put(`/notifications/${n.id}/read`); } catch { /* ignore */ }
    setTimeout(load, 300);
    if (n.target_url) nav(n.target_url);
  };

  const markAll = async () => {
    try { await api.put("/notifications/read-all"); load(); } catch { /* ignore */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-bell"
        className="relative text-dim hover:text-white p-1.5 rounded-md hover:bg-[#14161D] transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span data-testid="notification-badge"
                className="absolute -top-0.5 -right-0.5 bg-[#E05A50] text-black text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 surface rounded-md shadow-lg border border-[#22252F] z-50" data-testid="notification-panel">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1A1D24]">
            <span className="text-[11px] uppercase tracking-[0.18em] text-dim">Notifications</span>
            {unread > 0 && <button onClick={markAll} data-testid="mark-all-read" className="text-[10px] text-[#7AB8FF] hover:text-white">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <div className="p-6 text-center text-dim text-xs">No recent notifications.</div>}
            {items.map((n) => {
              const Icon = TYPE_ICON[n.type] || Bell;
              return (
                <button key={n.id} onClick={() => openItem(n)} data-testid={`notification-${n.id}`}
                        className={`w-full text-left px-3 py-2 border-b border-[#1A1D24] hover:bg-[#14161D] transition-colors ${!n.read ? "bg-[#0F1117]" : ""}`}>
                  <div className="flex items-start gap-2">
                    <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[#D9A05B]" />
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs truncate ${!n.read ? "text-white font-medium" : "text-dim"}`}>{n.title}</div>
                      <div className="text-[11px] text-dim truncate">{n.message}</div>
                      <div className="text-[10px] text-dim mt-0.5">{relTime(n.created_at)}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
