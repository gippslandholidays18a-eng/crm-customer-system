import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, X, Shield } from "lucide-react";

const ROLES = ["admin", "manager", "staff"];

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [items, setItems] = useState([]);
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get("/users").then((r) => {
      if (cancelled) return;
      setItems(r.data.items || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const create = async () => {
    try {
      await api.post("/users", {
        name: draft.name.trim(),
        email: draft.email.trim().toLowerCase(),
        password: draft.password,
        role: draft.role,
      });
      toast.success("User created");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not create user");
    }
  };

  const update = async (uid, patch) => {
    try {
      await api.put(`/users/${uid}`, patch);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.email}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Removed");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    }
  };

  const resetPw = async (u) => {
    const pw = window.prompt(`New password for ${u.email} (min 6 chars):`);
    if (!pw) return;
    await update(u.id, { password: pw });
    toast.success("Password updated");
  };

  if (loading) return <div className="text-dim text-sm">Loading…</div>;

  return (
    <div data-testid="admin-users-page" className="space-y-8 max-w-5xl">
      <header className="flex justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-dim">Settings · Admin</div>
          <h1 className="font-display text-3xl tracking-tight mt-1">Staff & user accounts</h1>
          <p className="text-sm text-dim mt-2 max-w-2xl">
            Three roles: <strong>admin</strong> (full access), <strong>manager</strong> (operations + CRM, no settings), <strong>staff</strong> (own tasks only).
          </p>
        </div>
        <button
          onClick={() => setDraft({ name: "", email: "", password: "", role: "staff" })}
          data-testid="add-user-button"
          className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90 h-fit"
        >
          <Plus className="w-4 h-4" /> New user
        </button>
      </header>

      {draft && (
        <div className="surface rounded-md p-6 space-y-3" data-testid="user-editor">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Name</label>
              <Input
                value={draft.name}
                data-testid="new-name"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 bg-transparent border-[#22252F]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Email</label>
              <Input
                type="email"
                value={draft.email}
                data-testid="new-email"
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="mt-1 bg-transparent border-[#22252F]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Temporary password</label>
              <Input
                type="text"
                value={draft.password}
                data-testid="new-password"
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                className="mt-1 bg-transparent border-[#22252F] font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Role</label>
              <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v })}>
                <SelectTrigger data-testid="new-role" className="mt-1 bg-transparent border-[#22252F]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDraft(null)} className="inline-flex items-center gap-1.5 text-sm text-dim hover:text-white px-3 py-2">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={create}
              data-testid="save-user"
              className="inline-flex items-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2 rounded-md hover:opacity-90"
            >
              <Save className="w-4 h-4" /> Create user
            </button>
          </div>
        </div>
      )}

      <div className="surface rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0E1015]">
            <tr className="text-[10px] uppercase tracking-[0.15em] text-[#6B7280]">
              <th className="text-left px-4 py-3 font-semibold">Name & email</th>
              <th className="text-left px-4 py-3 font-semibold">Role</th>
              <th className="text-center px-4 py-3 font-semibold">Active</th>
              <th className="text-right px-4 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody data-testid="users-table-body">
            {items.map((u) => (
              <tr key={u.id} className={`tbl-row ${!u.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-3">
                  <div className="text-white flex items-center gap-2">
                    {u.name} {u.id === me?.id && <span className="text-[10px] text-[#D9A05B]">(you)</span>}
                  </div>
                  <div className="text-[11px] text-dim">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={u.role}
                    onValueChange={(v) => update(u.id, { role: v })}
                    disabled={u.id === me?.id}
                  >
                    <SelectTrigger className="w-32 bg-transparent border-[#22252F] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12141A] border-[#22252F] text-white">
                      {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3 text-center">
                  <Switch
                    checked={u.active}
                    onCheckedChange={(v) => update(u.id, { active: v })}
                    disabled={u.id === me?.id}
                    data-testid={`active-${u.id}`}
                  />
                </td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button
                    onClick={() => resetPw(u)}
                    data-testid={`reset-pw-${u.id}`}
                    className="text-xs text-dim hover:text-white"
                  >
                    <Shield className="w-3.5 h-3.5 inline-block" /> reset pw
                  </button>
                  {u.id !== me?.id && (
                    <button
                      onClick={() => remove(u)}
                      data-testid={`delete-${u.id}`}
                      className="text-dim hover:text-[#E05A50]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
