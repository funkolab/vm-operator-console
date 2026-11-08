const BINARY: Record<string, number> = {
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};
const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const QUANTITY_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:(Ki|Mi|Gi|Ti|Pi|Ei|n|u|m|k|M|G|T|P|E)|[eE]([+-]?\d+))?$/;

/** Returns true when the value is a valid Kubernetes resource quantity. */
export function isQuantity(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && QUANTITY_RE.test(value.trim());
}

/** Parses a Kubernetes quantity ("4Gi", "500M", 1024) into a plain number. Returns NaN when invalid. */
export function parseQuantity(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return Number.NaN;
  if (typeof value === "number") return value;
  const m = QUANTITY_RE.exec(value.trim());
  if (!m) return Number.NaN;
  const num = Number(m[1]);
  if (m[3] !== undefined) return num * 10 ** Number(m[3]);
  const suffix = m[2] ?? "";
  return num * (BINARY[suffix] ?? DECIMAL[suffix] ?? 1);
}

/** Compares two quantities; returns negative, zero or positive. */
export function compareQuantity(a: string | number | undefined, b: string | number | undefined): number {
  return parseQuantity(a ?? 0) - parseQuantity(b ?? 0);
}

/** Formats a byte count for humans ("4 GiB"). */
export function formatBytes(bytes: number | undefined | null, digits = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number.isInteger(v) ? v : v.toFixed(digits)} ${units[i]}`;
}

/** Formats a quantity value for humans ("4Gi" → "4 GiB"). */
export function formatQuantity(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "—";
  return formatBytes(parseQuantity(value));
}

/** Converts a byte count into the most compact exact binary quantity ("4Gi"). */
export function bytesToQuantity(bytes: number): string {
  for (const unit of ["Ei", "Pi", "Ti", "Gi", "Mi", "Ki"]) {
    const f = BINARY[unit] as number;
    if (bytes >= f && bytes % f === 0) return `${bytes / f}${unit}`;
  }
  return String(bytes);
}
