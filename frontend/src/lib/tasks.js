// Stage 6B — Shared task constants, formatters, photo helpers.
import imageCompression from "browser-image-compression";

export const TASK_CATEGORIES = [
  { key: "maintenance",   label: "Maintenance",   color: "#E0904E", icon: "Wrench" },
  { key: "housekeeping",  label: "Housekeeping",  color: "#5BD1A8", icon: "Sparkles" },
  { key: "compliance",    label: "Compliance",    color: "#7AB8FF", icon: "ShieldCheck" },
  { key: "guest_issue",   label: "Guest issue",   color: "#E05A50", icon: "MessageCircleWarning" },
  { key: "restock",       label: "Restock",       color: "#D9A05B", icon: "PackagePlus" },
  { key: "admin",         label: "Admin",         color: "#8F95A3", icon: "ClipboardList" },
  { key: "inspection",    label: "Inspection",    color: "#B486E0", icon: "Eye" },
  { key: "photo_update",  label: "Photo update",  color: "#16B5C6", icon: "Camera" },
];

export const TASK_STATUSES = [
  { key: "open",         label: "Open",         color: "#8F95A3" },
  { key: "in_progress",  label: "In progress",  color: "#D9A05B" },
  { key: "blocked",      label: "Blocked",      color: "#E05A50" },
  { key: "done",         label: "Done",         color: "#5BD1A8" },
];

export const TASK_PRIORITIES = [
  { key: "low",     label: "Low",     color: "#5B606B" },
  { key: "medium",  label: "Medium",  color: "#8F95A3" },
  { key: "high",    label: "High",    color: "#E0904E" },
  { key: "urgent",  label: "Urgent",  color: "#E05A50" },
];

export const findCategory = (k) => TASK_CATEGORIES.find((c) => c.key === k) || TASK_CATEGORIES[0];
export const findStatus = (k) => TASK_STATUSES.find((s) => s.key === k) || TASK_STATUSES[0];
export const findPriority = (k) => TASK_PRIORITIES.find((p) => p.key === k) || TASK_PRIORITIES[1];

export const isOverdue = (task) => {
  if (!task?.due_date || task?.status === "done") return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.due_date < today;
};

export const fmtDueDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
};

export const fmtRelative = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return "";
  }
};

// Compress and convert an uploaded File to a base64 data URL.
// Target: ~1024px longest edge, < 250 KB.
export async function compressToDataUrl(file) {
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.25,
    maxWidthOrHeight: 1024,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.82,
  });
  return await imageCompression.getDataUrlFromFile(compressed);
}
