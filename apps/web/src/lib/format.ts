export function relativeTime(iso?: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.round((now - t) / 1000);
  const abs = Math.abs(s);
  const suffix = s >= 0 ? "ago" : "from now";
  if (abs < 45) return "just now";
  if (abs < 90) return `1 minute ${suffix}`;
  const m = Math.round(abs / 60);
  if (m < 45) return `${m} minutes ${suffix}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ${suffix}`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d > 1 ? "s" : ""} ${suffix}`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} month${mo > 1 ? "s" : ""} ${suffix}`;
  const y = Math.round(mo / 12);
  return `${y} year${y > 1 ? "s" : ""} ${suffix}`;
}

/** Compact age as shown by kubectl ("5d", "3h", "12m"). */
export function age(iso?: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

const dtf = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium" });
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : dtf.format(t);
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`;
}

export function downloadText(filename: string, content: string, type = "application/yaml") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
