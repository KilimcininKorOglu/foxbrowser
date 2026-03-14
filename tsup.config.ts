import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/bin.ts",
    "src/cli.ts",
    "src/server.ts",
    "src/cli/run.ts",
    "src/cli/commands/nav.ts",
    "src/cli/commands/obs.ts",
    "src/cli/commands/act.ts",
    "src/cli/commands/net.ts",
  ],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: { entry: ["src/cli.ts", "src/server.ts"] },
  splitting: false,
});
