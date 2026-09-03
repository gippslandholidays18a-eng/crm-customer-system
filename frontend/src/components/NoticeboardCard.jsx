import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, X, Trash2, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function NoticeboardCard() {
  const { user } = useAuth();
  const isMgr = user?.role === "admin" || user?.role === "manager";
  const [items, setItems] = useState([]);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api.get("/announcements").then((r) => setItems(r.data.items || [])).catch(() => {});
  }, [version]);

  const visible = items.filter((a) => !(a.dismissed_by || []).includes(user?.id));
  const unreadCount = visible.length;

  const dismiss = async (a) => {
    try { await api.post(`/announcements/${a.id}/dismiss`); refresh(); }
    catch { /* silent */ }
  };
  const remove = async (a) => {
    if (!window.confirm("Delete announcement?")) return;
    try { await api.delete(`/announcements/${a.id}`); refresh(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  if (visible.length === 0 && !isMgr) return null;

  return (
    <section data-testid="noticeboard" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.22em] text-dim inline-flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" /> Noticeboard
          {unreadCount > 0 && <span className="bg-[#E05A50] text-black text-[10px] font-medium rounded-full px-1.5 py-0" data-testid="notice-badge">{unreadCount}</span>}
        </div>
        {isMgr && (
          <button onClick={() => setCreating(true)} data-testid="new-announcement" className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> New announcement
          </button>
        )}
      </div>
      {visible.length === 0 && isMgr && (
        <div className="text-xs text-dim italic surface rounded-md p-4">No active announcements.</div>
      )}
      {visible.map((a) => (
        <div key={a.id} data-testid={`announcement-${a.id}`}
             className={`surface rounded-md p-4 flex items-start gap-3 ${a.priority === "Urgent" ? "border-[#E05A50]" : ""}`}
             style={a.priority === "Urgent" ? { borderColor: "#E05A50" } : {}}>
          {a.priority === "Urgent" && <AlertTriangle className="w-4 h-4 text-[#E05A50] flex-shrink-0 mt-0.5" />}
          <div className="flex-1">
            <div className="font-medium text-white">{a.title}</div>
            <div className="text-xs text-[#C9CCD3] whitespace-pre-wrap mt-1">{a.body}</div>
            <div className="text-[10px] text-dim mt-2">{a.posted_by_name} · {new Date(a.posted_at).toLocaleString()}</div>
          </div>
          <button onClick={() => dismiss(a)} data-testid={`dismiss-${a.id}`} className="text-dim hover:text-white" title="Dismiss"><X className="w-4 h-4" /></button>
          {isMgr && <button onClick={() => remove(a)} data-testid={`delete-announcement-${a.id}`} className="text-dim hover:text-[#E05A50]" title="Delete"><Trash2 className="w-4 h-4" /></button>}
        </div>
      ))}
      {creating && <NewAnnouncementModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); toast.success("Posted"); }} />}
    </section>
  );
}

function NewAnnouncementModal({ onClose, onSaved }) {
  const [d, setD] = useState({ title: "", body: "", priority: "Normal" });
  const save = async () => {
    if (!d.title.trim()) { toast.error("Title required"); return; }
    try { await api.post("/announcements", d); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="announcement-modal">
        <div className="font-display text-lg">New announcement</div>
        <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Title" data-testid="ann-title" className="bg-transparent border-[#22252F]" />
        <Textarea value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="Body" data-testid="ann-body" rows={4} className="bg-transparent border-[#22252F]" />
        <Select value={d.priority} onValueChange={(v) => setD({ ...d, priority: v })}>
          <SelectTrigger data-testid="ann-priority" className="bg-transparent border-[#22252F]"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
            <SelectItem value="Normal">Normal</SelectItem>
            <SelectItem value="Urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button><button onClick={save} data-testid="ann-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Post</button></div>
      </div>
    </div>
  );
}
