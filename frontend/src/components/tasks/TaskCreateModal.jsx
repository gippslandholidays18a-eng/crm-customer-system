import { useState } from "react";
import { api } from "@/lib/api";
import { TASK_CATEGORIES, TASK_PRIORITIES } from "@/lib/tasks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { X, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function TaskCreateModal({ properties, users, onClose, onCreated }) {
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    category: "maintenance",
    priority: "medium",
    due_date: "",
    property_id: "",
    assignee_id: "",
  });
  const [checklist, setChecklist] = useState([""]);
  const [busy, setBusy] = useState(false);

  const set = (patch) => setDraft({ ...draft, ...patch });

  const submit = async () => {
    if (!draft.title.trim()) {
      toast.error("Title is required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category,
        priority: draft.priority,
        due_date: draft.due_date || null,
        property_id: draft.property_id || null,
        assignee_id: draft.assignee_id || null,
        checklist: checklist.map((c) => c.trim()).filter(Boolean),
      };
      const r = await api.post("/tasks", payload);
      onCreated(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto" data-testid="task-create-modal" onClick={onClose}>
      <div className="surface rounded-md w-full max-w-2xl p-6 space-y-4 my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-dim">New task</div>
            <h2 className="font-display text-xl mt-1">Create a task</h2>
          </div>
          <button onClick={onClose} data-testid="task-create-close" className="text-dim hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>Title</Label>
            <Input
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. Replace kitchen tap washer"
              data-testid="task-title"
              autoFocus
              className="mt-1 bg-transparent border-[#22252F]"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Description</Label>
            <Textarea
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Context, links, vendor contact, etc."
              data-testid="task-description"
              rows={3}
              className="mt-1 bg-transparent border-[#22252F]"
            />
          </div>
          <FieldSelect
            label="Category" testid="task-category"
            value={draft.category} onChange={(v) => set({ category: v })}
            options={TASK_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
          />
          <FieldSelect
            label="Priority" testid="task-priority"
            value={draft.priority} onChange={(v) => set({ priority: v })}
            options={TASK_PRIORITIES.map((p) => ({ value: p.key, label: p.label }))}
          />
          <FieldSelect
            label="Property" testid="task-property"
            value={draft.property_id} onChange={(v) => set({ property_id: v })}
            options={[{ value: "__none__", label: "— None —" }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
            unsetValue="__none__"
          />
          <FieldSelect
            label="Assignee" testid="task-assignee"
            value={draft.assignee_id} onChange={(v) => set({ assignee_id: v })}
            options={[{ value: "__none__", label: "— Unassigned —" }, ...users.map((u) => ({ value: u.id, label: `${u.name || u.email} · ${u.role}` }))]}
            unsetValue="__none__"
          />
          <div>
            <Label>Due date</Label>
            <Input
              type="date"
              value={draft.due_date}
              onChange={(e) => set({ due_date: e.target.value })}
              data-testid="task-due"
              className="mt-1 bg-transparent border-[#22252F]"
            />
          </div>
        </div>

        <div>
          <Label>Checklist (optional)</Label>
          <div className="space-y-2 mt-1" data-testid="task-checklist-editor">
            {checklist.map((line, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={line}
                  placeholder={`Step ${i + 1}`}
                  onChange={(e) => {
                    const next = [...checklist];
                    next[i] = e.target.value;
                    setChecklist(next);
                  }}
                  data-testid={`task-checklist-${i}`}
                  className="bg-transparent border-[#22252F] text-sm"
                />
                {checklist.length > 1 && (
                  <button
                    onClick={() => setChecklist(checklist.filter((_, idx) => idx !== i))}
                    className="text-dim hover:text-[#E05A50]"
                    data-testid={`task-checklist-remove-${i}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setChecklist([...checklist, ""])}
              data-testid="task-checklist-add"
              className="inline-flex items-center gap-1 text-xs text-dim hover:text-white"
            >
              <Plus className="w-3 h-3" /> Add step
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="text-sm text-dim hover:text-white px-3 py-2">Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            data-testid="task-create-submit"
            className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {busy ? "Creating…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="text-[10px] uppercase tracking-[0.15em] text-dim">{children}</label>;
}

function FieldSelect({ label, value, onChange, options, testid, unsetValue }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select
        value={value || (unsetValue || "")}
        onValueChange={(v) => onChange(v === unsetValue ? "" : v)}
      >
        <SelectTrigger data-testid={testid} className="mt-1 bg-transparent border-[#22252F]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#12141A] border-[#22252F] text-white max-h-72">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
