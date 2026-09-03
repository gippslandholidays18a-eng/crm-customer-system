// Stage 6C — Compliance & housekeeping schedule helpers.

export const SCHEDULE_STATUSES = [
  { key: "overdue",  label: "Overdue",  color: "#E05A50" },
  { key: "due_soon", label: "Due soon", color: "#D9A05B" },
  { key: "ok",       label: "On track", color: "#5BD1A8" },
  { key: "inactive", label: "Inactive", color: "#5B606B" },
];

export const KIND_LABELS = {
  compliance: "Compliance",
  housekeeping: "Housekeeping",
};

export const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-AU", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
};

export const daysUntil = (iso) => {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(iso + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const cadenceLabel = (days) => {
  if (!days) return "—";
  if (days % 365 === 0) {
    const y = days / 365;
    return y === 1 ? "Annual" : `Every ${y} years`;
  }
  if (days === 90) return "Quarterly";
  if (days === 180) return "Biannual";
  if (days === 30) return "Monthly";
  if (days === 7) return "Weekly";
  return `Every ${days} days`;
};
