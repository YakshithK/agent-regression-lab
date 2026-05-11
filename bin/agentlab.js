#!/usr/bin/env node
import { main } from "../dist/index.js";
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
