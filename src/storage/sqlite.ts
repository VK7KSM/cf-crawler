import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureSqliteSchema(dbPath: string): Promise<void> {
    await mkdir(dirname(dbPath), { recursive: true });

    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
            run_id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            seed_url TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            url TEXT NOT NULL,
            final_url TEXT NOT NULL,
            http_status INTEGER NOT NULL,
            strategy TEXT NOT NULL,
            title TEXT,
            content_hash TEXT
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            source_url TEXT NOT NULL,
            item_type TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT
        );
        CREATE TABLE IF NOT EXISTS crawl_runs (
            id TEXT PRIMARY KEY,
            seed_url TEXT NOT NULL,
            goal TEXT NOT NULL,
            config TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'running'
        );
        CREATE TABLE IF NOT EXISTS crawl_queue (
            run_id TEXT NOT NULL,
            url TEXT NOT NULL,
            depth INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result TEXT,
            PRIMARY KEY (run_id, url),
            FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
        );
    `);

    db.close();
}

export interface CrawlRunRecord {
    id: string;
    seed_url: string;
    goal: string;
    config: string;
    started_at: number;
    status: string;
}

export interface CrawlQueueRecord {
    run_id: string;
    url: string;
    depth: number;
    status: string;
    result: string | null;
}

export async function findResumableRun(
    dbPath: string,
    seedUrl: string,
    configJson: string,
): Promise<CrawlRunRecord | null> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        const stmt = db.prepare(
            "SELECT id, seed_url, goal, config, started_at, status FROM crawl_runs WHERE seed_url = ? AND config = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
        );
        const row = stmt.get(seedUrl, configJson) as CrawlRunRecord | undefined;
        return row ?? null;
    } finally {
        db.close();
    }
}

export async function createCrawlRun(
    dbPath: string,
    run: { id: string; seed_url: string; goal: string; config: string },
): Promise<void> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        db.prepare(
            "INSERT INTO crawl_runs (id, seed_url, goal, config, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')",
        ).run(run.id, run.seed_url, run.goal, run.config, Date.now());
    } finally {
        db.close();
    }
}

export async function updateCrawlRunStatus(
    dbPath: string,
    runId: string,
    status: "done" | "error",
): Promise<void> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        db.prepare("UPDATE crawl_runs SET status = ? WHERE id = ?").run(status, runId);
    } finally {
        db.close();
    }
}

export async function getPendingUrls(
    dbPath: string,
    runId: string,
): Promise<CrawlQueueRecord[]> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        const stmt = db.prepare(
            "SELECT run_id, url, depth, status, result FROM crawl_queue WHERE run_id = ? AND status = 'pending' ORDER BY depth ASC",
        );
        return stmt.all(runId) as unknown as CrawlQueueRecord[];
    } finally {
        db.close();
    }
}

export async function getCompletedUrls(
    dbPath: string,
    runId: string,
): Promise<Set<string>> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        const stmt = db.prepare(
            "SELECT url FROM crawl_queue WHERE run_id = ? AND status = 'done'",
        );
        const rows = stmt.all(runId) as Array<{ url: string }>;
        return new Set(rows.map((r) => r.url));
    } finally {
        db.close();
    }
}

export async function upsertQueueUrl(
    dbPath: string,
    runId: string,
    url: string,
    depth: number,
    status: "pending" | "done" | "error" = "pending",
    result?: string,
): Promise<void> {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath);

    try {
        db.prepare(
            `INSERT INTO crawl_queue (run_id, url, depth, status, result)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(run_id, url) DO UPDATE SET status = excluded.status, result = excluded.result`,
        ).run(runId, url, depth, status, result ?? null);
    } finally {
        db.close();
    }
}
