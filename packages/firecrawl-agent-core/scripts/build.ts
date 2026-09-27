import { cpSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
});

for (const assetPath of ["src/orchestrator/prompts", "src/worker/prompts", "src/skills/definitions"]) {
  const outputPath = assetPath.replace(/^src\//, "dist/");
  mkdirSync(outputPath.substring(0, outputPath.lastIndexOf("/")), { recursive: true });
  cpSync(assetPath, outputPath, { recursive: true });
}
