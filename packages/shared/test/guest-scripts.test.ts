import { describe, expect, test } from "bun:test";
import { lintGuestScript } from "../src/guest-scripts";

const errors = (t: "CloudInit" | "Sysprep", s: string) => lintGuestScript(t, s).filter((i) => i.severity === "error");
const warnings = (t: "CloudInit" | "Sysprep", s: string) => lintGuestScript(t, s).filter((i) => i.severity === "warning");

describe("lintGuestScript", () => {
  test("accepts a valid cloud-config", () => {
    expect(lintGuestScript("CloudInit", "#cloud-config\nhostname: web\npackages: [nginx]\n")).toEqual([]);
  });

  test("reports YAML errors with their line", () => {
    const e = errors("CloudInit", "#cloud-config\nhostname: web\nusers: [ops\n");
    expect(e).toHaveLength(1);
    expect(e[0]?.message).toStartWith("YAML:");
    expect(e[0]?.line).toBeGreaterThan(1);
  });

  test("a cloud-config must be a mapping", () => {
    expect(errors("CloudInit", "#cloud-config\n- a\n- b\n")[0]?.message).toContain("mapping");
  });

  test("warns when cloud-init would ignore the payload", () => {
    expect(warnings("CloudInit", "hostname: web\n")[0]?.message).toContain("#cloud-config");
    expect(lintGuestScript("CloudInit", "#!/bin/bash\necho hi\n")).toEqual([]);
  });

  test("empty scripts are errors", () => {
    expect(errors("CloudInit", "  \n")).toHaveLength(1);
    expect(errors("Sysprep", "")).toHaveLength(1);
  });

  test("Sysprep needs an unattend document", () => {
    expect(lintGuestScript("Sysprep", '<?xml version="1.0"?>\n<unattend xmlns="urn:schemas-microsoft-com:unattend"></unattend>')).toEqual([]);
    expect(warnings("Sysprep", "<settings/>")).toHaveLength(1);
  });
});
