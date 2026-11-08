export interface KubeStatus {
  kind?: "Status";
  status?: string;
  message?: string;
  reason?: string;
  code?: number;
  details?: { name?: string; kind?: string; causes?: { reason?: string; message?: string; field?: string }[] };
}

export class KubeError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: KubeStatus,
  ) {
    super(body.message || `Kubernetes API error ${status}`);
    this.name = "KubeError";
  }

  get reason() {
    return this.body.reason ?? "Unknown";
  }

  get causes() {
    return this.body.details?.causes ?? [];
  }
}

export const isNotFound = (e: unknown) => e instanceof KubeError && e.status === 404;
export const isConflict = (e: unknown) => e instanceof KubeError && e.status === 409;
export const isForbidden = (e: unknown) => e instanceof KubeError && e.status === 403;
