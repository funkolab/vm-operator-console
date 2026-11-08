import { expect, test } from "@playwright/test";

// Guards the toolchain choice: tests and their workers run on Bun, not Node.
test("test workers run on Bun", () => {
  expect(process.versions.bun).toBeTruthy();
});
