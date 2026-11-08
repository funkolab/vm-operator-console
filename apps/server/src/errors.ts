import type { ApiErrorBody, ValidationIssue } from "@console/shared";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { KubeError } from "./k8s/errors";
import { log } from "./log";

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: ValidationIssue[],
  ) {
    super(message);
  }
}

export const validationError = (details: ValidationIssue[], message = "Validation failed") => new ApiError(422, "ValidationFailed", message, details);

/** Converts a Kubernetes cause field ("spec.compute.memorySize") to a JSON pointer. */
export function fieldToPointer(field?: string): string {
  if (!field) return "";
  return `/${field
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .join("/")}`;
}

export function toErrorBody(err: unknown): { status: ContentfulStatusCode; body: ApiErrorBody } {
  if (err instanceof ApiError)
    return { status: err.status, body: { error: { code: err.code, message: err.message, status: err.status, details: err.details } } };
  if (err instanceof KubeError) {
    const status = (err.status >= 400 && err.status < 600 ? err.status : 502) as ContentfulStatusCode;
    const details = err.causes.map((c) => ({ path: fieldToPointer(c.field), message: c.message ?? c.reason ?? "" }));
    return {
      status,
      body: { error: { code: err.reason, message: err.message, status, details: details.length ? details : undefined } },
    };
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: `/${i.path.join("/")}`, message: i.message }));
    return { status: 400, body: { error: { code: "BadRequest", message: "Invalid request", status: 400, details } } };
  }
  if (err instanceof HTTPException) return { status: err.status, body: { error: { code: "HTTPError", message: err.message, status: err.status } } };
  log.error("Unhandled error", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  return { status: 500, body: { error: { code: "InternalError", message: "Internal server error", status: 500 } } };
}

export function errorHandler(err: Error, c: Context) {
  const { status, body } = toErrorBody(err);
  if (status >= 500) log.error("Request failed", { path: c.req.path, status, message: body.error.message });
  return c.json(body, status);
}
