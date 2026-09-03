import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Inbox as InboxIcon, Search, Send, Archive, Mail, Sparkles, RefreshCw, Circle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const STATUS_TABS = ["All", "New", "AI Draft Ready", "Replied", "Archived"];
const SENTIMENTS = ["All", "Positive", "Negative", "Urgent"];
const DAY_RANGES = [
  { key: 7, label: "Last 7 days" },
  { key: 30, label: "Last 30 days" },
  { key: 0, label: "All" },
];
const SENT_COLOR = { positive: "#5BD1A8", neutral: "#8F95A3", negative: "#E05A50" };
const STATUS_COLOR = { New: "#7AB8FF", "AI Draft Ready": "#D9A05B", Replied: "#5BD1A8", Archived: "#5B606B" };

function relTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function Inbox() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("All");
  const [sentiment, setSentiment] = useState("All");
  const [propertyId, setPropertyId] = useState("all");
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [properties, setProperties] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [replyBody, setReplyBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    api.get("/properties").then((r) => setProperties(r.data.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim().length >= 3 ? q.trim() : ""), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const params = {};
    if (status !== "All") params.status = status;
    if (sentiment !== "All") params.sentiment = sentiment;
    if (propertyId !== "all") params.property_id = propertyId;
    if (days) params.days = days;
    if (debouncedQ) params.q = debouncedQ;
    api.get("/inbox", { params }).then((r) => setItems(r.data.items || [])).catch(() => {});
  }, [status, sentiment, propertyId, days, debouncedQ, version]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    api.get(`/inbox/${selectedId}`).then((r) => {
      setDetail(r.data);
      setReplyBody("");
      if (!r.data.message.read) api.post(`/inbox/${selectedId}/read?read=true`).then(refresh);
    });
  }, [selectedId, refresh]);

  const draftAi = async () => {
    if (!selectedId) return;
    try {
      const r = await api.post(`/inbox/${selectedId}/draft-reply`);
      toast.info(r.data.note);
      setReplyBody(r.data.message.ai_draft_body || "");
    } catch (e) { toast.error("Draft failed"); }
  };

  const sendReply = async () => {
    if (!replyBody.trim()) { toast.error("Write a reply first"); return; }
    if (!selectedId) return;
    try {
      const r = await api.post(`/inbox/${selectedId}/send-reply`, { reply_body: replyBody });
      toast.success("Reply sent");
      setReplyBody("");
      refresh();
      if (r.data.message?.id) setSelectedId(selectedId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    }
  };

  const archive = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/inbox/${selectedId}/archive?archived=true`);
      toast.success("Archived");
      setSelectedId(null);
      refresh();
    } catch { toast.error("Failed"); }
  };

  const activeMsg = detail?.message;

  return (
    <div className="space-y-6" data-testid="inbox-page">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Communications</div>
          <h1 className="font-display text-3xl tracking-tight mt-1">Guest inbox</h1>
        </div>
        <button onClick={() => setCreating(true)} data-testid="new-inbox-msg"
                className="inline-flex items-center gap-2 border border-[#22252F] text-sm px-4 py-2 rounded-md hover:border-[#3A3F4C]">
          <Mail className="w-4 h-4" /> Log guest message
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        {/* Filters */}
        <aside className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim mb-2">Status</div>
            <div className="space-y-1">
              {STATUS_TABS.map((s) => (
                <button key={s} onClick={() => setStatus(s)} data-testid={`filter-status-${s}`}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${status === s ? "bg-[#1A1D24] text-white" : "text-dim hover:text-white"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim mb-2">Sentiment</div>
            <div className="space-y-1">
              {SENTIMENTS.map((s) => (
                <button key={s} onClick={() => setSentiment(s)}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded ${sentiment === s ? "bg-[#1A1D24] text-white" : "text-dim hover:text-white"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim mb-2">Property</div>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger data-testid="filter-property" className="bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
                <SelectItem value="all">All properties</SelectItem>
                {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-dim mb-2">Date range</div>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="bg-transparent border-[#22252F] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                {DAY_RANGES.map((d) => <SelectItem key={d.key} value={String(d.key)}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </aside>

        {/* List */}
        <section className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute top-2.5 left-2.5 text-dim" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages (min 3 chars)"
                   data-testid="inbox-search" className="pl-8 bg-transparent border-[#22252F] text-sm" />
          </div>
          <div className="surface rounded-md overflow-hidden divide-y divide-[#1A1D24]" data-testid="inbox-list">
            {items.length === 0 && <div className="p-6 text-center text-dim text-sm">No messages match.</div>}
            {items.map((m) => (
              <button key={m.id} onClick={() => setSelectedId(m.id)} data-testid={`inbox-row-${m.id}`}
                      className={`w-full text-left p-3 hover:bg-[#14161D] transition-colors ${selectedId === m.id ? "bg-[#1A1D24]" : ""} ${!m.read ? "font-medium" : ""}`}>
                <div className="flex items-start gap-2">
                  {!m.read && <Circle className="w-2 h-2 mt-1.5 fill-[#D9A05B] text-[#D9A05B] flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`text-sm truncate ${m.read ? "text-dim" : "text-white"}`}>{m.from_guest_name || m.from_guest_email}</span>
                      <span className="ml-auto text-[10px] text-dim flex-shrink-0">{relTime(m.received_at)}</span>
                    </div>
                    <div className={`text-xs truncate ${m.read ? "text-dim" : "text-white"}`}>{m.subject}</div>
                    <div className="text-[11px] text-dim truncate mt-0.5">{m.preview}</div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ color: SENT_COLOR[m.sentiment], borderColor: SENT_COLOR[m.sentiment] + "66" }}>{m.sentiment}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ color: STATUS_COLOR[m.status], borderColor: STATUS_COLOR[m.status] + "66" }}>{m.status}</span>
                      {m.urgent && <span className="text-[9px] px-1.5 py-0.5 rounded-full border text-[#E05A50] border-[#E05A50]/40 inline-flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" />urgent</span>}
                      {m.property_name && <span className="text-[9px] text-dim">· {m.property_name}</span>}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Detail */}
        <section data-testid="inbox-detail" className="min-w-0">
          {!activeMsg ? (
            <div className="surface rounded-md p-10 text-center text-dim text-sm">
              <InboxIcon className="w-6 h-6 mx-auto mb-2 opacity-50" />
              Select a message to open the conversation.
            </div>
          ) : (
            <div className="surface rounded-md p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-dim">{activeMsg.property_name || "—"}</div>
                  <div className="font-display text-lg mt-0.5 truncate">{activeMsg.subject}</div>
                  <div className="text-xs text-dim mt-1 truncate">{activeMsg.from_guest_name} · {activeMsg.from_guest_email} · {relTime(activeMsg.received_at)}</div>
                </div>
                <button onClick={archive} data-testid="archive-btn" className="text-dim hover:text-white inline-flex items-center gap-1 text-xs">
                  <Archive className="w-3.5 h-3.5" /> Archive
                </button>
              </div>

              <div className="space-y-3">
                {(detail?.thread || [activeMsg]).map((m) => (
                  <div key={m.id} data-testid={`thread-msg-${m.id}`}
                       className={`rounded-md p-3 border ${m.direction === "outbound" ? "border-[#D9A05B]/30 bg-[#D9A05B]/5 ml-6" : "border-[#22252F] bg-[#0F1117] mr-6"}`}>
                    <div className="text-[10px] text-dim mb-1">
                      {m.direction === "outbound" ? `Sent by ${m.sent_by_user_name || "you"}` : m.from_guest_name || m.from_guest_email}
                      · {relTime(m.created_at)}
                      {m.send_error && <span className="text-[#E05A50]"> · error: {m.send_error}</span>}
                    </div>
                    <div className="text-sm whitespace-pre-wrap text-white">{m.body}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#1A1D24] pt-4 space-y-2">
                <div className="flex items-center gap-2">
                  <button onClick={draftAi} data-testid="draft-ai-btn" className="text-[11px] inline-flex items-center gap-1 border border-[#22252F] rounded-full px-3 py-1 text-dim hover:text-white">
                    <Sparkles className="w-3 h-3" /> Draft with AI (coming soon)
                  </button>
                  <button onClick={refresh} className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1"><RefreshCw className="w-3 h-3" />Refresh</button>
                </div>
                <Textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={5}
                          placeholder="Write your reply to the guest…"
                          data-testid="reply-body" className="bg-transparent border-[#22252F] text-sm" />
                <div className="flex justify-end">
                  <button onClick={sendReply} data-testid="send-reply-btn"
                          className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90">
                    <Send className="w-4 h-4" /> Send reply
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {creating && <LogMessageModal properties={properties} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
    </div>
  );
}

function LogMessageModal({ properties, onClose, onSaved }) {
  const [d, setD] = useState({ source: "email", from_guest_name: "", from_guest_email: "",
    subject: "", body: "", property_id: "", sentiment: "neutral", urgent: false });
  const save = async () => {
    if (!d.from_guest_email.includes("@")) { toast.error("Guest email required"); return; }
    const body = { ...d };
    if (!body.property_id) delete body.property_id;
    try { await api.post("/inbox", body); toast.success("Logged"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="surface rounded-md p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} data-testid="log-message-modal">
        <div className="font-display text-lg">Log guest message</div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Guest name" value={d.from_guest_name} onChange={(e) => setD({ ...d, from_guest_name: e.target.value })} className="bg-transparent border-[#22252F]" />
          <Input placeholder="Guest email" value={d.from_guest_email} onChange={(e) => setD({ ...d, from_guest_email: e.target.value })} data-testid="log-email" className="bg-transparent border-[#22252F]" />
        </div>
        <Input placeholder="Subject" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} data-testid="log-subject" className="bg-transparent border-[#22252F]" />
        <Textarea placeholder="Message body" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} rows={4} data-testid="log-body" className="bg-transparent border-[#22252F]" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={d.source} onValueChange={(v) => setD({ ...d, source: v })}>
            <SelectTrigger className="bg-transparent border-[#22252F] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
              <SelectItem value="email">Email</SelectItem><SelectItem value="review">Review</SelectItem><SelectItem value="form_submission">Form submission</SelectItem>
            </SelectContent>
          </Select>
          <Select value={d.sentiment} onValueChange={(v) => setD({ ...d, sentiment: v, urgent: v === "negative" })}>
            <SelectTrigger className="bg-transparent border-[#22252F] text-sm"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
              <SelectItem value="positive">Positive</SelectItem><SelectItem value="neutral">Neutral</SelectItem><SelectItem value="negative">Negative</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={d.property_id || "__none__"} onValueChange={(v) => setD({ ...d, property_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="bg-transparent border-[#22252F] text-sm"><SelectValue placeholder="Property (optional)" /></SelectTrigger>
          <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
            <SelectItem value="__none__">— None —</SelectItem>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-dim px-3 py-2">Cancel</button>
          <button onClick={save} data-testid="log-save" className="bg-brand text-black text-sm font-medium px-4 py-2 rounded-md">Save</button>
        </div>
      </div>
    </div>
  );
}
