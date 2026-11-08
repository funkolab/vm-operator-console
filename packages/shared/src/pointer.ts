/** Minimal RFC 6901 JSON Pointer helpers. */

export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function getPointer(obj: unknown, pointer: string): unknown {
  let cur: unknown = obj;
  for (const seg of parsePointer(pointer)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Sets a value, creating intermediate objects (or arrays for numeric segments). */
export function setPointer(obj: Record<string, unknown>, pointer: string, value: unknown): void {
  const segs = parsePointer(pointer);
  if (!segs.length) throw new Error("Cannot set the document root");
  let cur: Record<string, unknown> = obj;
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (last) {
      if (value === undefined) delete cur[seg];
      else cur[seg] = value;
      return;
    }
    const next = segs[i + 1] as string;
    if (cur[seg] === undefined || cur[seg] === null || typeof cur[seg] !== "object") cur[seg] = /^\d+$/.test(next) ? [] : {};
    cur = cur[seg] as Record<string, unknown>;
  });
}
