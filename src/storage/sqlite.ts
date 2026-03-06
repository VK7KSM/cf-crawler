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
    `);

    db.close();
}
