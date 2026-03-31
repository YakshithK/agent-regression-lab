import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function ensureParentDir(path: string): void {
  ensureDir(dirname(path));
}
