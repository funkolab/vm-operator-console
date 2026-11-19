import { describe, expect, test } from "bun:test";
import { isSupportedPcVersion, parsePcVersion } from "../src/pc-version";

describe("Prism Central version", () => {
  test("parses build versions", () => {
    expect(parsePcVersion("pc.7.6")).toEqual([7, 6]);
    expect(parsePcVersion("7.6.0.1")).toEqual([7, 6, 0, 1]);
    expect(parsePcVersion("pc.2024.3")).toEqual([2024, 3]);
    expect(parsePcVersion("unknown")).toBeUndefined();
  });

  test("accepts 7.6 and later", () => {
    for (const v of ["pc.7.6", "7.6", "pc.7.6.0.1", "pc.7.7", "7.10", "pc.8.0"]) expect(isSupportedPcVersion(v)).toBe(true);
  });

  test("rejects older, calendar and unknown versions", () => {
    for (const v of ["pc.7.5", "7.3.1", "pc.2024.3", "pc.2022.6", "", "master", undefined]) expect(isSupportedPcVersion(v)).toBe(false);
  });
});
