import type { ApiType } from "@console/server";
import type { ApiErrorBody, ValidationIssue } from "@console/shared";
import { hc } from "hono/client";

export const basePath: string = document.querySelector('meta[name="console-base-path"]')?.getAttribute("content") ?? "";

export const api = hc<ApiType>(`${window.location.origin}${basePath}/api`, {
  init: { credentials: "same-origin" },
});

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };

/** Awaits a Hono RPC call, throwing ApiError for non-2xx responses and returning the typed JSON body. */
export async function unwrap<R extends JsonResponse>(p: Promise<R>): Promise<Exclude<Awaited<ReturnType<R["json"]>>, ApiErrorBody>> {
  let res: R;
  try {
    res = await p;
  } catch (e) {
    throw new ApiError(`Network error: ${(e as Error).message}`, 0, "NetworkError");
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) window.dispatchEvent(new CustomEvent("console:unauthenticated"));
    throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, res.status, body?.error?.code ?? "Error", body?.error?.details ?? []);
  }
  return (await res.json()) as Exclude<Awaited<ReturnType<R["json"]>>, ApiErrorBody>;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details.length && e.code === "ValidationFailed") return `${e.message}: ${e.details[0]?.message}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function errorIssues(e: unknown): ValidationIssue[] {
  return e instanceof ApiError ? e.details : [];
}
