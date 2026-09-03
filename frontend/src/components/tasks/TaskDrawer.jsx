import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  TASK_CATEGORIES, TASK_STATUSES, TASK_PRIORITIES,
  findCategory, findStatus, findPriority, fmtDueDate, fmtRelative,
  compressToDataUrl,
} from "@/lib/tasks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  X, Save, Trash2, Camera, ListChecks, MessageSquare, Loader2,
} from "lucide-react";
import { toast } from "sonner";

export default function TaskDrawer({ taskId, onClose, onChanged, properties, users }) {
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [draft, setDraft] = useState({});
  const [version, setVersion] = useState(0);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const isMgr = user?.role === "admin" || user?.role === "manager";
  const isAssignee = task?.assignee_id === user?.id;
  const canEdit = isMgr;
  const canFlipStatus = isMgr || isAssignee;
  const canAttachPhoto = isMgr || isAssignee;
  const canManageChecklist = isMgr;
  const canToggleChecklist = isMgr || isAssignee;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/tasks/${taskId}`).then((r) => {
      if (cancelled) return;
      setTask(r.data);
      setDraft({
        title: r.data.title,
        description: r.data.description || "",
        category: r.data.category,
        priority: r.data.priority,
        due_date: r.data.due_date || "",
        property_id: r.data.property_id || "",
        assignee_id: r.data.assignee_id || "",
      });
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      toast.error(e?.response?.data?.detail || "Could not load task");
      setLoading(false);
      onClose();
    });
    return () => { cancelled = true; };
  }, [taskId, version, onClose]);

  const updateField = async (patch) => {
    setSaving(true);
    try {
      const r = await api.put(`/tasks/${taskId}`, patch);
      setTask(r.data);
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveMeta = async () => {
    setSaving(true);
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        category: draft.category,
        priority: draft.priority,
        due_date: draft.due_date || null,
        property_id: draft.property_id || null,
        assignee_id: draft.assignee_id || null,
      };
      const r = await api.put(`/tasks/${taskId}`, payload);
      setTask(r.data);
      setEditingMeta(false);
      toast.success("Saved");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async () => {
    if (!window.confirm(`Delete task "${task.title}"?`)) return;
    try {
      await api.delete(`/tasks/${taskId}`);
      toast.success("Deleted");
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  const handlePhotos = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        const dataUrl = await compressToDataUrl(f);
        await api.post(`/tasks/${taskId}/photos`, { data_url: dataUrl, label: f.name });
      }
      toast.success("Photos attached");
      refresh();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading || !task) {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-dim text-sm">Loading…</div>
      </Shell>
    );
  }

  const cat = findCategory(task.category);
  const st = findStatus(task.status);
  const pr = findPriority(task.priority);

  return (
    <Shell onClose={onClose}>
      <div className="flex justify-between items-start p-5 border-b divider">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em]">
            <span style={{ color: cat.color }}>{cat.label}</span>
            <span className="text-dim">·</span>
            <span style={{ color: pr.color }}>{pr.label}</span>
          </div>
          {editingMeta ? (
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              data-testid="drawer-title-input"
              className="mt-2 bg-transparent border-[#22252F] text-lg"
            />
          ) : (
            <h2 className="font-display text-xl mt-1 truncate" data-testid="drawer-title">{task.title}</h2>
          )}
          <div className="text-[11px] text-dim mt-2">
            {task.property_name || "No property"} · created {fmtRelative(task.created_at)} by {task.created_by_name}
          </div>
        </div>
        <button onClick={onClose} data-testid="drawer-close" className="text-dim hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Status quick-flip */}
      <div className="px-5 pt-5">
        <div className="flex flex-wrap gap-1.5" data-testid="status-flip">
          {TASK_STATUSES.map((s) => {
            const active = task.status === s.key;
            return (
              <button
                key={s.key}
                disabled={!canFlipStatus}
                onClick={() => !active && updateField({ status: s.key })}
                data-testid={`status-flip-${s.key}`}
                className={`px-3 py-1 text-[11px] rounded-full border transition-colors ${
                  active ? "bg-[#1A1D24]" : "hover:bg-[#14161D]"
                } ${canFlipStatus ? "" : "opacity-50 cursor-not-allowed"}`}
                style={active ? { color: s.color, borderColor: s.color + "88" } : { color: "#8F95A3", borderColor: "#22252F" }}
              >
                {s.label}
              </button>
            );
          })}
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-dim self-center ml-1" />}
        </div>
      </div>

      {/* Meta */}
      <div className="p-5 grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
        <MetaCell label="Status" value={<span style={{ color: st.color }}>{st.label}</span>} />
        <MetaCell label="Priority" value={<span style={{ color: pr.color }}>{pr.label}</span>} />
        <MetaCell label="Property" value={task.property_name || "—"} />
        <MetaCell label="Assignee" value={task.assignee_name || "—"} />
        <MetaCell label="Due date" value={fmtDueDate(task.due_date)} />
        <MetaCell label="Completed" value={task.completed_at ? `${fmtRelative(task.completed_at)} · ${task.completed_by_name}` : "—"} />
      </div>

      {/* Description / edit */}
      <div className="px-5 pb-2">
        {!editingMeta ? (
          <>
            {task.description && (
              <div className="text-sm text-[#C9CCD3] whitespace-pre-wrap" data-testid="drawer-description">
                {task.description}
              </div>
            )}
            {canEdit && (
              <button
                onClick={() => setEditingMeta(true)}
                data-testid="drawer-edit-meta"
                className="mt-3 text-[11px] text-dim hover:text-white"
              >
                Edit details
              </button>
            )}
          </>
        ) : (
          <div className="space-y-3" data-testid="drawer-edit-form">
            <Textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              data-testid="drawer-description-input"
              rows={3}
              className="bg-transparent border-[#22252F] text-sm"
              placeholder="Description"
            />
            <div className="grid grid-cols-2 gap-2">
              <DrawerSelect
                value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })}
                testid="drawer-category"
                options={TASK_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
              />
              <DrawerSelect
                value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })}
                testid="drawer-priority"
                options={TASK_PRIORITIES.map((p) => ({ value: p.key, label: p.label }))}
              />
              <DrawerSelect
                value={draft.property_id || "__none__"} onChange={(v) => setDraft({ ...draft, property_id: v === "__none__" ? "" : v })}
                testid="drawer-property"
                options={[{ value: "__none__", label: "— None —" }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <DrawerSelect
                value={draft.assignee_id || "__none__"} onChange={(v) => setDraft({ ...draft, assignee_id: v === "__none__" ? "" : v })}
                testid="drawer-assignee"
                options={[{ value: "__none__", label: "— Unassigned —" }, ...users.map((u) => ({ value: u.id, label: `${u.name || u.email} · ${u.role}` }))]}
              />
              <Input
                type="date"
                value={draft.due_date || ""}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                data-testid="drawer-due"
                className="bg-transparent border-[#22252F] text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingMeta(false)} className="text-xs text-dim hover:text-white px-3 py-2">Cancel</button>
              <button
                onClick={saveMeta}
                disabled={saving}
                data-testid="drawer-save-meta"
                className="inline-flex items-center gap-1.5 bg-brand text-black text-xs font-medium px-3 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" /> Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Checklist */}
      <Section title="Checklist" icon={<ListChecks className="w-4 h-4" />}>
        <ChecklistEditor
          task={task}
          canManage={canManageChecklist}
          canToggle={canToggleChecklist}
          onChange={refresh}
        />
      </Section>

      {/* Photos */}
      <Section title={`Photos (${task.photos?.length || 0}/12)`} icon={<Camera className="w-4 h-4" />}>
        {task.photos?.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="drawer-photos">
            {task.photos.map((p) => (
              <PhotoTile key={p.id} taskId={task.id} photo={p} canDelete={canAttachPhoto} onChanged={refresh} />
            ))}
          </div>
        )}
        {canAttachPhoto && (
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              data-testid="drawer-photo-input"
              onChange={(e) => handlePhotos(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="drawer-photo-upload"
              className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-white border border-[#22252F] hover:border-[#3A3F4C] rounded-md px-3 py-2"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
              {uploading ? "Compressing…" : "Add photos"}
            </button>
          </div>
        )}
      </Section>

      {/* Comments */}
      <Section title={`Comments (${task.comments?.length || 0})`} icon={<MessageSquare className="w-4 h-4" />}>
        <CommentsSection task={task} onChange={refresh} />
      </Section>

      {/* Footer */}
      {isMgr && (
        <div className="p-5 border-t divider flex justify-end">
          <button
            onClick={deleteTask}
            data-testid="drawer-delete"
            className="inline-flex items-center gap-1.5 text-xs text-[#E05A50] hover:opacity-80"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete task
          </button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex" data-testid="task-drawer" onClick={onClose}>
      <div
        className="ml-auto w-full sm:max-w-xl h-full bg-[#0B0C11] border-l divider overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function MetaCell({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-dim">{label}</div>
      <div className="text-[13px] text-white mt-0.5">{value}</div>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="px-5 py-4 border-t divider">
      <div className="text-[11px] uppercase tracking-[0.22em] text-dim flex items-center gap-2 mb-3">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function DrawerSelect({ value, onChange, options, testid }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testid} className="bg-transparent border-[#22252F] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChecklistEditor({ task, canManage, canToggle, onChange }) {
  const [newText, setNewText] = useState("");

  const add = async () => {
    if (!newText.trim()) return;
    try {
      await api.post(`/tasks/${task.id}/checklist`, { text: newText.trim() });
      setNewText("");
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add");
    }
  };

  const toggle = async (item) => {
    if (!canToggle) return;
    try {
      await api.put(`/tasks/${task.id}/checklist/${item.id}`, { done: !item.done });
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    }
  };

  const remove = async (item) => {
    try {
      await api.delete(`/tasks/${task.id}/checklist/${item.id}`);
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not remove");
    }
  };

  return (
    <div className="space-y-1.5" data-testid="drawer-checklist">
      {(task.checklist || []).map((item) => (
        <div key={item.id} className="flex items-start gap-2 group" data-testid={`checklist-item-${item.id}`}>
          <button
            onClick={() => toggle(item)}
            disabled={!canToggle}
            data-testid={`checklist-toggle-${item.id}`}
            className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px] transition-colors ${
              item.done
                ? "bg-[#5BD1A8] border-[#5BD1A8] text-black"
                : "border-[#3A3F4C] hover:border-white"
            } ${canToggle ? "" : "opacity-50 cursor-not-allowed"}`}
          >
            {item.done ? "✓" : ""}
          </button>
          <div className={`text-xs flex-1 ${item.done ? "line-through text-dim" : "text-[#C9CCD3]"}`}>
            {item.text}
            {item.done && item.done_by_name && (
              <span className="ml-2 text-[10px] text-dim">— {item.done_by_name}</span>
            )}
          </div>
          {canManage && (
            <button
              onClick={() => remove(item)}
              data-testid={`checklist-remove-${item.id}`}
              className="text-dim hover:text-[#E05A50] opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
      {canManage && (
        <div className="flex gap-2 pt-2">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a step…"
            data-testid="checklist-new-input"
            className="bg-transparent border-[#22252F] text-sm"
          />
          <button
            onClick={add}
            data-testid="checklist-new-submit"
            className="bg-brand text-black text-xs font-medium px-3 rounded-md hover:opacity-90"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function PhotoTile({ taskId, photo, canDelete, onChanged }) {
  const [fullSrc, setFullSrc] = useState(null);
  const [loadingFull, setLoadingFull] = useState(false);

  const open = async () => {
    setLoadingFull(true);
    try {
      const r = await api.get(`/tasks/${taskId}`);
      const full = (r.data.photos || []).find((p) => p.id === photo.id);
      if (full?.data_url) setFullSrc(full.data_url);
    } finally {
      setLoadingFull(false);
    }
  };

  const remove = async (e) => {
    e.stopPropagation();
    if (!window.confirm("Remove this photo?")) return;
    try {
      await api.delete(`/tasks/${taskId}/photos/${photo.id}`);
      onChanged();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not remove");
    }
  };

  return (
    <>
      <button
        onClick={open}
        data-testid={`photo-tile-${photo.id}`}
        className="relative h-24 bg-[#14161D] rounded-md border border-[#22252F] flex items-center justify-center text-[10px] text-dim overflow-hidden hover:border-[#3A3F4C]"
      >
        {photo.data_url ? (
          <img src={photo.data_url} alt={photo.label || "photo"} className="w-full h-full object-cover" />
        ) : (
          <>
            <Camera className="w-4 h-4 mr-1" />
            View
          </>
        )}
        {canDelete && (
          <span
            onClick={remove}
            data-testid={`photo-delete-${photo.id}`}
            className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] hover:text-[#E05A50]"
          >
            ×
          </span>
        )}
      </button>
      {fullSrc && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6"
          onClick={() => setFullSrc(null)}
          data-testid="photo-lightbox"
        >
          <img src={fullSrc} alt={photo.label || "photo"} className="max-w-full max-h-full" />
        </div>
      )}
      {loadingFull && !fullSrc && <span className="hidden">loading</span>}
    </>
  );
}

function CommentsSection({ task, onChange }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/comments`, { body: body.trim() });
      setBody("");
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="drawer-comments">
      {(task.comments || []).length === 0 && (
        <div className="text-xs text-dim">No comments yet.</div>
      )}
      {(task.comments || []).map((c) => (
        <div key={c.id} className="text-xs" data-testid={`comment-${c.id}`}>
          <div className="text-[#C9CCD3] whitespace-pre-wrap">{c.body}</div>
          <div className="text-[10px] text-dim mt-1">{c.user_name} · {fmtRelative(c.created_at)}</div>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
          data-testid="comment-input"
          rows={2}
          className="bg-transparent border-[#22252F] text-sm"
        />
        <button
          onClick={submit}
          disabled={busy}
          data-testid="comment-submit"
          className="bg-brand text-black text-xs font-medium px-3 rounded-md hover:opacity-90 disabled:opacity-50"
        >
          Post
        </button>
      </div>
    </div>
  );
}
