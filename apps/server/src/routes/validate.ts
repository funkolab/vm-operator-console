import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { validationError } from "../errors";

/** zValidator that reports failures with the console's error envelope. */
export const zv = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result) => {
    if (!result.success)
      throw validationError(
        result.error.issues.map((i) => ({ path: `/${i.path.map(String).join("/")}`, message: i.message })),
        "Invalid request",
      );
  });
