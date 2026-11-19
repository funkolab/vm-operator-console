import { describe, expect, test } from "bun:test";
import { adviseRightsizing, type MetricPoint, percentile } from "../src";

const series = (n: number, cpu: (i: number) => number, mem: (i: number) => number): MetricPoint[] =>
  Array.from({ length: n }, (_, i) => ({ t: new Date(i * 3_600_000).toISOString(), cpu: cpu(i), mem: mem(i), guestMem: mem(i) }));

describe("rightsizing", () => {
  test("percentile", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBeUndefined();
  });

  test("needs enough samples", () => {
    expect(
      adviseRightsizing(
        series(
          5,
          () => 50,
          () => 50,
        ),
        4,
        8,
      ).verdict,
    ).toBe("insufficient-data");
  });

  test("idle VM is oversized", () => {
    const a = adviseRightsizing(
      series(
        48,
        () => 4,
        () => 20,
      ),
      8,
      32,
    );
    expect(a.verdict).toBe("oversized");
    expect(a.cpu.suggested).toBeLessThan(8);
    expect(a.cpu.suggested).toBeGreaterThanOrEqual(1);
    expect(a.memory.suggestedGiB).toBe(16);
    expect(a.delta.vcpus).toBeGreaterThan(0);
  });

  test("busy VM is undersized", () => {
    const a = adviseRightsizing(
      series(
        48,
        (i) => (i % 10 === 0 ? 70 : 92),
        () => 90,
      ),
      2,
      4,
    );
    expect(a.verdict).toBe("undersized");
    expect(a.cpu.suggested).toBeGreaterThan(2);
    expect(a.memory.suggestedGiB).toBe(8);
  });

  test("healthy VM is balanced; a single spike does not trigger a resize", () => {
    const a = adviseRightsizing(
      series(
        100,
        (i) => (i === 50 ? 100 : 45),
        () => 60,
      ),
      4,
      8,
    );
    expect(a.verdict).toBe("balanced");
  });

  test("shrinks at most by half per step", () => {
    const a = adviseRightsizing(
      series(
        48,
        () => 1,
        () => 10,
      ),
      16,
      64,
    );
    expect(a.cpu.suggested).toBe(8);
    expect(a.memory.suggestedGiB).toBe(32);
  });

  test("ignores guest page cache when the hypervisor reports low active memory", () => {
    const pts = series(
      48,
      () => 45,
      () => 25,
    ).map((p) => ({ ...p, guestMem: 95 }));
    expect(adviseRightsizing(pts, 4, 8).memory.suggestedGiB).toBe(4);
  });

  test("respects the socket granularity", () => {
    const a = adviseRightsizing(
      series(
        48,
        () => 95,
        () => 50,
      ),
      4,
      8,
      2,
    );
    expect(a.cpu.suggested % 2).toBe(0);
  });
});
