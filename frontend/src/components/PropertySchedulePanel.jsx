import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { SCHEDULE_STATUSES, fmtDate, cadenceLabel } from "@/lib/schedules";
import {
  ShieldCheck, Sparkles, CheckCircle2, Plus, RefreshCw, Trash2, Save, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export default function PropertySchedulePanel({ propertyId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({
    kind: "compliance",
    subtype: "",
    label: "",
    cadence_days: 365,
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/schedules?property_id=${propertyId}`)
      .then((r) => { if (!cancelled) { setItems(r.data.items || []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId, version]);

  const refresh = () => setVersion((v) => v + 1);

  const seed = async () => {
    try {
      const r = await api.post(`/schedules/seed-defaults?property_id=${propertyId}`);
      toast.success(`Seeded ${r.data.inserted} item(s)`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not seed");
    }
  };

  const markDone = async (item) => {
    setBusyId(item.id);
    try {
      await api.post(`/schedules/${item.id}/mark-done`);
      toast.success("Marked done");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not mark done");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove "${item.label}" from this property?`)) return;
    try {
      await api.delete(`/schedules/${item.id}`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not delete");
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditDraft({
      label: item.label,
      cadence_days: item.cadence_days,
      notes: item.notes || "",
      active: !!item.active,
      last_done_at: item.last_done_at || "",
    });
  };

  const saveEdit = async () => {
    try {
      await api.put(`/schedules/${editingId}`, {
        label: editDraft.label,
        cadence_days: parseInt(editDraft.cadence_days) || 0,
        notes: editDraft.notes,
        active: editDraft.active,
        last_done_at: editDraft.last_done_at || null,
      });
      toast.success("Saved");
      setEditingId(null);
      setEditDraft(null);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const addCustom = async () => {
    if (!addDraft.label.trim() || !addDraft.subtype.trim()) {
      toast.error("Label and subtype are required");
      return;
    }
    try {
      await api.post("/schedules", {
        property_id: propertyId,
        kind: addDraft.kind,
        subtype: addDraft.subtype.trim(),
        label: addDraft.label.trim(),
        cadence_days: parseInt(addDraft.cadence_days) || 365,
        notes: addDraft.notes,
      });
      toast.success("Item added");
      setAdding(false);
      setAddDraft({ kind: "compliance", subtype: "", label: "", cadence_days: 365, notes: "" });
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not add");
    }
  };

  return (
    <div className="space-y-3" data-testid={`schedule-panel-${propertyId}`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-dim">
          Schedule ({items.length})
        </div>
        <div className="flex gap-2">
          <button
            onClick={seed}
            data-testid="schedule-seed-defaults"
            className="text-[11px] text-dim hover:text-white inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Seed defaults
          </button>
          <button
            onClick={() => setAdding(true)}
            data-testid="schedule-add-custom"
            className="text-[11px] text-[#D9A05B] hover:text-white inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add custom item
          </button>
        </div>
      </div>

      {adding && (
        <div className="surface rounded-md p-3 space-y-2" data-testid="schedule-add-editor">
          <div className="grid grid-cols-2 gap-2">
            <Select value={addDraft.kind} onValueChange={(v) => setAddDraft({ ...addDraft, kind: v })}>
              <SelectTrigger data-testid="schedule-add-kind" className="bg-transparent border-[#22252F] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                <SelectItem value="compliance">Compliance</SelectItem>
                <SelectItem value="housekeeping">Housekeeping</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number" min="1"
              value={addDraft.cadence_days}
              onChange={(e) => setAddDraft({ ...addDraft, cadence_days: e.target.value })}
              placeholder="Cadence (days)"
              data-testid="schedule-add-cadence"
              className="bg-transparent border-[#22252F] text-sm"
            />
            <Input
              value={addDraft.subtype}
              onChange={(e) => setAddDraft({ ...addDraft, subtype: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
              placeholder="Subtype key (e.g. fire_extinguisher)"
              data-testid="schedule-add-subtype"
              className="bg-transparent border-[#22252F] text-sm font-mono"
            />
            <Input
              value={addDraft.label}
              onChange={(e) => setAddDraft({ ...addDraft, label: e.target.value })}
              placeholder="Label (e.g. Fire extinguisher)"
              data-testid="schedule-add-label"
              className="bg-transparent border-[#22252F] text-sm"
            />
            <Input
              value={addDraft.notes}
              onChange={(e) => setAddDraft({ ...addDraft, notes: e.target.value })}
              placeholder="Notes"
              data-testid="schedule-add-notes"
              className="bg-transparent border-[#22252F] text-sm col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-xs text-dim hover:text-white px-3 py-1.5">
              <X className="w-3 h-3 inline" /> Cancel
            </button>
            <button
              onClick={addCustom}
              data-testid="schedule-add-submit"
              className="text-xs bg-brand text-black font-medium px-3 py-1.5 rounded-md hover:opacity-90"
            >
              <Save className="w-3 h-3 inline mr-1" /> Add
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-dim p-3">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-dim italic p-3">No schedule items yet · click “Seed defaults” to start.</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => {
            const st = SCHEDULE_STATUSES.find((s) => s.key === it.status) || SCHEDULE_STATUSES[2];
            const isEditing = editingId === it.id;
            return (
              <div
                key={it.id}
                data-testid={`schedule-item-${it.id}`}
                className="border border-[#22252F] rounded-md p-2.5"
              >
                {!isEditing ? (
                  <div className="flex items-center gap-3 text-xs">
                    {it.kind === "compliance"
                      ? <ShieldCheck className="w-3.5 h-3.5 text-[#7AB8FF] flex-shrink-0" />
                      : <Sparkles className="w-3.5 h-3.5 text-[#5BD1A8] flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-white">{it.label}</div>
                      <div className="text-[10px] text-dim">
                        {cadenceLabel(it.cadence_days)} · last {fmtDate(it.last_done_at)} · next {fmtDate(it.next_due_at)}
                      </div>
                    </div>
                    <span
                      className="text-[10px] inline-block px-2 py-0.5 rounded-full border"
                      style={{ color: st.color, borderColor: st.color + "55" }}
                      data-testid={`schedule-status-${it.id}`}
                    >
                      {st.label}
                    </span>
                    <button
                      onClick={() => markDone(it)}
                      disabled={busyId === it.id}
                      data-testid={`schedule-mark-done-${it.id}`}
                      title="Mark done"
                      className="text-[#5BD1A8] hover:text-white disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => startEdit(it)}
                      data-testid={`schedule-edit-${it.id}`}
                      title="Edit"
                      className="text-dim hover:text-white"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => remove(it)}
                      data-testid={`schedule-delete-${it.id}`}
                      title="Remove"
                      className="text-dim hover:text-[#E05A50]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2" data-testid={`schedule-editor-${it.id}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={editDraft.label}
                        onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                        data-testid={`schedule-edit-label-${it.id}`}
                        className="bg-transparent border-[#22252F] text-xs"
                      />
                      <Input
                        type="number" min="1"
                        value={editDraft.cadence_days}
                        onChange={(e) => setEditDraft({ ...editDraft, cadence_days: e.target.value })}
                        data-testid={`schedule-edit-cadence-${it.id}`}
                        className="bg-transparent border-[#22252F] text-xs"
                      />
                      <Input
                        type="date"
                        value={editDraft.last_done_at || ""}
                        onChange={(e) => setEditDraft({ ...editDraft, last_done_at: e.target.value })}
                        data-testid={`schedule-edit-last-${it.id}`}
                        className="bg-transparent border-[#22252F] text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={editDraft.active}
                          onCheckedChange={(v) => setEditDraft({ ...editDraft, active: v })}
                          data-testid={`schedule-edit-active-${it.id}`}
                        />
                        <span className="text-xs text-dim">{editDraft.active ? "Active" : "Paused"}</span>
                      </div>
                      <Input
                        value={editDraft.notes}
                        onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                        placeholder="Notes"
                        className="bg-transparent border-[#22252F] text-xs col-span-2"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setEditingId(null); setEditDraft(null); }} className="text-[11px] text-dim hover:text-white">
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        data-testid={`schedule-edit-save-${it.id}`}
                        className="text-[11px] bg-brand text-black font-medium px-3 py-1 rounded-md hover:opacity-90"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
