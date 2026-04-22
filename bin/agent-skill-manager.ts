#!/usr/bin/env node

import { isCLIMode, runCLI } from "../src/cli";

if (isCLIMode(process.argv)) {
  await runCLI(process.argv);
} else {
  const { main } = await import("../src/index.tsx");
  await main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export {};
