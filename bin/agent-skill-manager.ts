#!/usr/bin/env node

import { isCLIMode, runCLI } from "../src/cli";
import { fatalErrorForDisplay } from "../src/utils/errors";

if (isCLIMode(process.argv)) {
  await runCLI(process.argv).catch((err) => {
    console.error("Fatal error:", fatalErrorForDisplay(err));
    process.exit(1);
  });
} else {
  const { main } = await import("../src/index.tsx");
  await main().catch((err) => {
    console.error("Fatal error:", fatalErrorForDisplay(err));
    process.exit(1);
  });
}

export {};
