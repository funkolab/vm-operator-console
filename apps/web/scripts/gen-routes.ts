// Regenerates src/routeTree.gen.ts without running Vite (used by typecheck in CI).
import { resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";

const root = resolve(import.meta.dir, "..");
const config = getConfig({ target: "react", autoCodeSplitting: true, routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts" }, root);
await new Generator({ config, root }).run();
console.log("Route tree generated");
