import type { Context } from "hono";
import type { AccessService } from "./auth/access";
import type { AppEnv } from "./auth/identity";
import type { Config } from "./config";
import type { KubeClient } from "./k8s/client";
import type { PrismService } from "./prism/service";
import type { ContextService } from "./services/contexts";
import type { TemplateService } from "./services/templates";
import type { VMService } from "./services/vms";
import type { VMServiceService } from "./services/vmservices";
import type { StreamHub } from "./stream/hub";

export interface Deps {
  cfg: Config;
  /** Client authenticated as the console ServiceAccount (or kubeconfig user). */
  sa: KubeClient;
  access: AccessService;
  prism: PrismService;
  vms: VMService;
  templates: TemplateService;
  contexts: ContextService;
  vmServices: VMServiceService;
  hub: StreamHub;
  readiness: () => Promise<{ ok: boolean; message?: string }>;
}

/** The impersonated client for the current request. */
export function userClient(c: Context<AppEnv>, deps: Deps): KubeClient {
  return deps.sa.as(c.get("identity"));
}

export function userName(c: Context<AppEnv>): string | undefined {
  return c.get("identity")?.user;
}
