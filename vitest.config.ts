import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      // React site tests live beside the source under website-src/src
      "website-src/src/**/*.test.{js,jsx}",
    ],
    setupFiles: ["src/test-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  esbuild: {
    jsx: "automatic",
  },
});
