import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  esbuild: {
    jsx: "automatic",
  },
});
