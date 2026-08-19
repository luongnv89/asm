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
    // Measurement only (#438) — no thresholds / CI fail gate. Include src/
    // product files so the first number is comparable to M3's target.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      reporter: ["text", "text-summary"],
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
