/** Minimum Prism Central version supported by vm-operator (older versions are rejected by the operator). */
export const MIN_PC_VERSION = "7.6";

/**
 * Parses a Prism Central build version ("pc.7.6", "7.6.0.1", "pc.2024.3") into
 * numeric parts. Returns undefined when no version number can be read.
 */
export function parsePcVersion(version?: string): number[] | undefined {
  const m = version?.trim().match(/(\d+(?:\.\d+)*)/);
  return m?.[1]?.split(".").map(Number);
}

/**
 * Whether a Prism Central version meets MIN_PC_VERSION. Calendar versions
 * (pc.2022.x – pc.2024.x) predate the 7.x numbering and are not supported;
 * an unknown version cannot be verified and is not supported either.
 */
export function isSupportedPcVersion(version?: string): boolean {
  const parts = parsePcVersion(version);
  if (!parts?.length) return false;
  if ((parts[0] ?? 0) >= 2000) return false;
  const min = parsePcVersion(MIN_PC_VERSION) as number[];
  for (let i = 0; i < Math.max(parts.length, min.length); i++) {
    const a = parts[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

export function unsupportedPcVersionMessage(version?: string): string {
  return version
    ? `Prism Central ${version} is not supported: version ${MIN_PC_VERSION} or later is required`
    : `Could not determine the Prism Central version: version ${MIN_PC_VERSION} or later is required`;
}
