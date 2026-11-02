import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The renderer's `@renderer/...` alias (see electron.vite.config.ts), so a test can
  // import a module that itself imports through it.
  resolve: {
    alias: {
      "@renderer": resolve("frontend/renderer/src"),
    },
  },
  // The app's JSX needs no `import React` (the build's React plugin does the same).
  esbuild: { jsx: "automatic" },
  test: {
    include: ["frontend/renderer/src/**/*.test.ts"],
  },
});
