import type { MetricPoint } from "./insights";

/**
 * Rightsizing advice derived from observed utilization. Uses the 95th
 * percentile (bursts matter, single spikes do not) and only suggests changes
 * that vm-operator can apply: sockets and memory, in steps of whole sockets
 * and power-of-two GiB.
 */
export type RightsizingVerdict = "oversized" | "undersized" | "balanced" | "insufficient-data";

export interface RightsizingAdvice {
  verdict: RightsizingVerdict;
  samples: number;
  cpu: { p95?: number; avg?: number; current: number; suggested: number };
  memory: { p95?: number; avg?: number; currentGiB: number; suggestedGiB: number };
  /** Human-readable reasons, in priority order. */
  reasons: string[];
  /** Estimated freed (negative = added) resources if the advice is applied. */
  delta: { vcpus: number; memoryGiB: number };
}

export const RIGHTSIZING = {
  minSamples: 24,
  cpuHigh: 80,
  cpuLow: 20,
  memHigh: 85,
  memLow: 35,
  /** Target utilization after resizing. */
  cpuTarget: 60,
  memTarget: 65,
} as const;

export function percentile(values: number[], p: number): number | undefined {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined);
const round1 = (v?: number) => (v === undefined ? undefined : Math.round(v * 10) / 10);

function nextPow2GiB(gib: number): number {
  if (gib <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(gib));
}

/**
 * @param vcpus total vCPUs (sockets × cores × threads)
 * @param coresPerUnit vCPUs per socket (cores × threads), the resize granularity
 */
export function adviseRightsizing(points: MetricPoint[], vcpus: number, memoryGiB: number, coresPerUnit = 1): RightsizingAdvice {
  const cpuVals = points.map((p) => p.cpu).filter((v): v is number => v !== undefined);
  // Use the hypervisor's active-memory view: guest-reported usage counts the
  // page cache, which Linux grows to fill any amount of RAM.
  const memVals = points.map((p) => p.mem ?? p.guestMem).filter((v): v is number => v !== undefined);
  const samples = Math.min(cpuVals.length, memVals.length || cpuVals.length);
  const cpuP95 = percentile(cpuVals, 95);
  const memP95 = percentile(memVals, 95);
  const advice: RightsizingAdvice = {
    verdict: "balanced",
    samples,
    cpu: { p95: round1(cpuP95), avg: round1(avg(cpuVals)), current: vcpus, suggested: vcpus },
    memory: { p95: round1(memP95), avg: round1(avg(memVals)), currentGiB: memoryGiB, suggestedGiB: memoryGiB },
    reasons: [],
    delta: { vcpus: 0, memoryGiB: 0 },
  };
  if (samples < RIGHTSIZING.minSamples || cpuP95 === undefined) {
    advice.verdict = "insufficient-data";
    advice.reasons.push(`At least ${RIGHTSIZING.minSamples} samples are needed (have ${samples})`);
    return advice;
  }
  const unit = Math.max(1, coresPerUnit);
  const neededVcpus = (vcpus * cpuP95) / RIGHTSIZING.cpuTarget;
  if (cpuP95 >= RIGHTSIZING.cpuHigh) {
    advice.cpu.suggested = Math.max(vcpus + unit, Math.ceil(neededVcpus / unit) * unit);
    advice.reasons.push(`CPU p95 is ${round1(cpuP95)}% — add vCPU to keep headroom`);
  } else if (cpuP95 <= RIGHTSIZING.cpuLow && vcpus > unit) {
    // Shrink at most by half per step: idle today is not idle forever.
    advice.cpu.suggested = Math.max(unit, Math.ceil(vcpus / 2 / unit) * unit, Math.ceil(neededVcpus / unit) * unit);
    if (advice.cpu.suggested < vcpus) advice.reasons.push(`CPU p95 is only ${round1(cpuP95)}% — ${vcpus - advice.cpu.suggested} vCPU can be reclaimed`);
  }
  if (memP95 !== undefined) {
    const neededGiB = (memoryGiB * memP95) / RIGHTSIZING.memTarget;
    if (memP95 >= RIGHTSIZING.memHigh) {
      advice.memory.suggestedGiB = Math.max(memoryGiB * 2, nextPow2GiB(neededGiB));
      advice.reasons.push(`Memory p95 is ${round1(memP95)}% — the guest is close to swapping`);
    } else if (memP95 <= RIGHTSIZING.memLow && memoryGiB > 1) {
      const s = Math.max(1, nextPow2GiB(neededGiB), memoryGiB / 2);
      if (s < memoryGiB) {
        advice.memory.suggestedGiB = s;
        advice.reasons.push(`Memory p95 is only ${round1(memP95)}% — ${memoryGiB - s} GiB can be reclaimed`);
      }
    }
  }
  advice.delta = { vcpus: vcpus - advice.cpu.suggested, memoryGiB: memoryGiB - advice.memory.suggestedGiB };
  const grows = advice.cpu.suggested > vcpus || advice.memory.suggestedGiB > memoryGiB;
  const shrinks = advice.cpu.suggested < vcpus || advice.memory.suggestedGiB < memoryGiB;
  advice.verdict = grows ? "undersized" : shrinks ? "oversized" : "balanced";
  if (advice.verdict === "balanced") advice.reasons.push("Utilization is within the healthy band");
  return advice;
}
