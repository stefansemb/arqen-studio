import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, PROJECTS_DIR } from "./paths";
import type { StepName } from "./steps/names";

export type SourceType = "url" | "script" | "notes" | "roundup" | "demo";

/**
 * "draft": created but not started yet (e.g. waiting for clip uploads).
 * "review": a run stopped before rendering on purpose, e.g. so the user can check the script.
 */
export type ProjectStatus = "draft" | "queued" | "running" | "review" | "done" | "failed";

export interface ProjectRow {
  id: string;
  /**
   * "url": article fetched and rewritten by AI. "script": user-supplied narration, read verbatim.
   * "notes": AI writes the script from the user's notes (and clips).
   */
  source_type: SourceType;
  /** Set for projects created together from the Batch page. */
  batch_id: string | null;
  url: string;
  niche: string;
  duration_min: number;
  title: string | null;
  status: ProjectStatus;
  current_step: StepName | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  project_id: string;
  ts: string;
  step: string | null;
  level: "info" | "warn" | "error";
  message: string;
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "studio.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      niche TEXT NOT NULL,
      duration_min REAL NOT NULL,
      title TEXT,
      status TEXT NOT NULL,
      current_step TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id),
      from_step TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id),
      ts TEXT NOT NULL,
      step TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_project ON events(project_id, id);
  `);
  const cols = db.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "source_type")) {
    db.exec(`ALTER TABLE projects ADD COLUMN source_type TEXT NOT NULL DEFAULT 'url'`);
  }
  const jobCols = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!jobCols.some((c) => c.name === "to_step")) db.exec(`ALTER TABLE jobs ADD COLUMN to_step TEXT`);
  if (!cols.some((c) => c.name === "batch_id")) db.exec(`ALTER TABLE projects ADD COLUMN batch_id TEXT`);
  return db;
}

const now = () => new Date().toISOString();

export function createProject(input: {
  url: string;
  niche: string;
  durationMin: number;
  sourceType?: SourceType;
  title?: string;
  status?: "draft" | "queued";
  batchId?: string;
}): ProjectRow {
  const id = randomUUID().slice(0, 8);
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO projects (id, source_type, url, niche, duration_min, title, status, batch_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.sourceType ?? "url", input.url, input.niche, input.durationMin, input.title ?? null, input.status ?? "queued", input.batchId ?? null, t, t);
  return getProject(id)!;
}

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare(`SELECT * FROM projects ORDER BY created_at DESC LIMIT 100`).all() as unknown as ProjectRow[];
}

/**
 * Removes a project, its jobs, events and files. Refuses while a job for it is queued or
 * running, so the worker never writes into a folder that was just deleted.
 * Returns false if the project doesn't exist.
 */
export function deleteProject(id: string): boolean {
  const db = getDb();
  if (!/^[a-z0-9-]+$/i.test(id) || !getProject(id)) return false;
  const busy = db.prepare(`SELECT 1 FROM jobs WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1`).get(id);
  if (busy) throw new Error("The project is still being worked on. Wait until it has finished.");
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM events WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM jobs WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  fs.rmSync(path.join(PROJECTS_DIR, id), { recursive: true, force: true });
  return true;
}

export function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, "title" | "status" | "current_step" | "error">>,
): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE projects SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => patch[k] ?? null), now(), id);
}

export function addEvent(projectId: string, step: string | null, level: EventRow["level"], message: string): void {
  getDb()
    .prepare(`INSERT INTO events (project_id, ts, step, level, message) VALUES (?, ?, ?, ?, ?)`)
    .run(projectId, now(), step, level, message);
}

export function listEvents(projectId: string, afterId = 0): EventRow[] {
  return getDb()
    .prepare(`SELECT * FROM events WHERE project_id = ? AND id > ? ORDER BY id`)
    .all(projectId, afterId) as unknown as EventRow[];
}

/** Queues a run from `fromStep` through `toStep` (default: to the end). */
export function enqueueJob(projectId: string, fromStep: StepName, toStep?: StepName): void {
  getDb()
    .prepare(`INSERT INTO jobs (project_id, from_step, to_step, created_at) VALUES (?, ?, ?, ?)`)
    .run(projectId, fromStep, toStep ?? null, now());
  updateProject(projectId, { status: "queued", error: null });
}

/** Atomically claim the oldest queued job. */
export function claimJob(): { id: number; project_id: string; from_step: StepName; to_step: StepName | null } | undefined {
  return getDb()
    .prepare(
      `UPDATE jobs SET status = 'running'
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1)
       RETURNING id, project_id, from_step, to_step`,
    )
    .get() as { id: number; project_id: string; from_step: StepName; to_step: StepName | null } | undefined;
}

export function finishJob(id: number, status: "done" | "failed"): void {
  getDb().prepare(`UPDATE jobs SET status = ? WHERE id = ?`).run(status, id);
}

/** Jobs left 'running' by a crashed worker go back to the queue. */
export function requeueStaleJobs(): number {
  // Resume from the step that was interrupted rather than redoing (and re-paying for) earlier steps.
  return Number(
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'queued',
           from_step = COALESCE((SELECT current_step FROM projects WHERE projects.id = jobs.project_id), from_step)
         WHERE status = 'running'`,
      )
      .run().changes,
  );
}
