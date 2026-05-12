#!/usr/bin/env node
import { main } from "../dist/index.js";
import { formatCliErrorMessage } from "../dist/runOutput.js";
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(formatCliErrorMessage(message));
  process.exitCode = 1;
});
