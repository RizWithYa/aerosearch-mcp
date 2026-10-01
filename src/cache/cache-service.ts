import Database from "better-sqlite3";
import crypto from "node:crypto";

export interface CacheOptions {
  dbPath?: string;
  defaultTtlMs?: number;
}

export class CacheService {
  private db: Database.Database;
  private defaultTtlMs: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs || 6 * 60 * 60 * 1000; // default 6 hours
    const dbPath = options.dbPath || "aerosearch.db";
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_cache (
        query_hash TEXT PRIMARY KEY,
        normalized_query TEXT NOT NULL,
        result_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_expires_at ON search_cache (expires_at);
    `);
  }

  private hashQuery(query: string): string {
    const normalized = query.trim().toLowerCase();
    return crypto.createHash("sha256").update(normalized).digest("hex");
  }

  public get(query: string): string | null {
    const hash = this.hashQuery(query);
    const now = Date.now();

    const stmt = this.db.prepare(`
      SELECT result_text, expires_at FROM search_cache
      WHERE query_hash = ?
    `);
    const row = stmt.get(hash) as { result_text: string; expires_at: number } | undefined;

    if (!row) {
      return null;
    }

    if (row.expires_at < now) {
      this.delete(hash);
      return null;
    }

    return row.result_text;
  }

  public set(query: string, result: string, ttlMs?: number): void {
    const hash = this.hashQuery(query);
    const normalized = query.trim().toLowerCase();
    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this.defaultTtlMs);

    const stmt = this.db.prepare(`
      INSERT INTO search_cache (query_hash, normalized_query, result_text, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(query_hash) DO UPDATE SET
        result_text = excluded.result_text,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at
    `);
    stmt.run(hash, normalized, result, now, expiresAt);
  }

  private delete(hash: string): void {
    const stmt = this.db.prepare("DELETE FROM search_cache WHERE query_hash = ?");
    stmt.run(hash);
  }

  public clear(): void {
    this.db.exec("DELETE FROM search_cache");
  }

  public close(): void {
    this.db.close();
  }
}
