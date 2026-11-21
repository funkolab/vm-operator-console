import { describe, expect, test } from "bun:test";
import { AccessService } from "../../src/auth/access";
import { KubeError } from "../../src/k8s/errors";
import { setLogLevel } from "../../src/log";
import { FakeKube } from "./fake-kube";

setLogLevel("error");

const ALICE = { user: "alice", groups: ["team-a-admins"] };

function workspace(name: string, namespace: string, displayName?: string) {
  return {
    metadata: { name, annotations: displayName ? { "kommander.mesosphere.io/display-name": displayName } : {} },
    spec: { namespaceName: namespace },
    status: { namespaceRef: { name: namespace } },
  };
}

/** RBAC stub: alice may list VMs in team-a-ns and kommander only. */
function setup(withWorkspaces = true) {
  const kube = new FakeKube();
  if (withWorkspaces) {
    kube.seed("workspaces", workspace("team-a", "team-a-ns", "Team A"));
    kube.seed("workspaces", workspace("kommander-workspace", "kommander", "Management Cluster Workspace"));
    kube.seed("workspaces", workspace("team-b", "team-b-ns"));
  } else {
    const list = kube.list.bind(kube);
    kube.list = (async (rt, ns, opts) => {
      if (rt.plural === "workspaces") throw new KubeError(404, { reason: "NotFound", message: "the server could not find the requested resource" });
      return list(rt, ns, opts);
    }) as typeof kube.list;
  }
  for (const ns of ["team-a-ns", "team-b-ns", "kommander", "default"]) kube.seed("namespaces", { metadata: { name: ns } });
  const access = new AccessService(kube, 60_000, []);
  const allowed = new Set(["team-a-ns", "kommander", "default"]);
  access.check = async (_id, verb, _res, ns) => verb === "list" && !!ns && allowed.has(ns);
  return access;
}

describe("workspaces", () => {
  test("lists only the Kommander workspaces the user can access, mapped to their namespace", async () => {
    const access = setup();
    const { source, workspaces } = await access.workspaces(ALICE);
    expect(source).toBe("kommander");
    expect(workspaces.map((w) => [w.name, w.displayName, w.namespace])).toEqual([
      ["kommander-workspace", "Management Cluster Workspace", "kommander"],
      ["team-a", "Team A", "team-a-ns"],
    ]);
    // Namespaces outside any workspace ("default") are not offered.
    expect((await access.namespaces(ALICE)).map((n) => n.name)).toEqual(["kommander", "team-a-ns"]);
  });

  test("falls back to one workspace per namespace without the Workspace API", async () => {
    const access = setup(false);
    const { source, workspaces } = await access.workspaces(ALICE);
    expect(source).toBe("namespaces");
    expect(workspaces.map((w) => [w.name, w.namespace])).toEqual([
      ["default", "default"],
      ["kommander", "kommander"],
      ["team-a-ns", "team-a-ns"],
    ]);
  });
});
