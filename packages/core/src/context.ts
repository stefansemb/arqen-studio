import fs from "node:fs";
import path from "node:path";
import type { ProjectRow } from "./db";
import type { StepName } from "./steps/names";

export interface StepContext {
  project: ProjectRow;
  /** Absolute path of data/projects/<id>. */
  dir: string;
  step: StepName;
  log: (message: string, level?: "info" | "warn" | "error") => void;
}

export function readJson<T>(ctx: StepContext, file: string): T {
  const p = path.join(ctx.dir, file);
  if (!fs.existsSync(p)) throw new Error(`Missing ${file}. Run the earlier pipeline steps first.`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function writeJson(ctx: StepContext, file: string, data: unknown): void {
  fs.writeFileSync(path.join(ctx.dir, file), JSON.stringify(data, null, 2));
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Add it to .env in the project root.`);
  return v;
}
