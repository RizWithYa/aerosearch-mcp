import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CacheService } from "../src/cache/cache-service.js";

describe("CacheService", () => {
  const dbPath = ":memory:";
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService({ dbPath, defaultTtlMs: 1000 });
  });

  afterEach(() => {
    cache.close();
  });

  it("stores and retrieves cached search results by normalized query", () => {
    cache.set("  Next.js 15 features  ", "Cached Output");
    const hit = cache.get("next.js 15 features");
    expect(hit).toBe("Cached Output");
  });

  it("handles case-insensitive query normalization", () => {
    cache.set("Typescript Generics", "TS Output");
    expect(cache.get("typescript generics")).toBe("TS Output");
    expect(cache.get("  TYPESCRIPT GENERICS  ")).toBe("TS Output");
  });

  it("returns null for non-existent query", () => {
    expect(cache.get("unknown query")).toBeNull();
  });

  it("overwrites existing cache entries on set with same normalized query", () => {
    cache.set("react hooks", "Old Output");
    expect(cache.get("react hooks")).toBe("Old Output");

    cache.set("REACT HOOKS", "New Output");
    expect(cache.get("react hooks")).toBe("New Output");
  });

  it("expires entries past custom TTL", async () => {
    cache.set("quick expiring", "Fast Data", 50); // 50ms TTL
    expect(cache.get("quick expiring")).toBe("Fast Data");
    await new Promise((r) => setTimeout(r, 70));
    expect(cache.get("quick expiring")).toBeNull();
  });

  it("expires entries past default TTL", async () => {
    const shortTtlCache = new CacheService({ dbPath: ":memory:", defaultTtlMs: 40 });
    try {
      shortTtlCache.set("default ttl query", "Default TTL Data");
      expect(shortTtlCache.get("default ttl query")).toBe("Default TTL Data");
      await new Promise((r) => setTimeout(r, 60));
      expect(shortTtlCache.get("default ttl query")).toBeNull();
    } finally {
      shortTtlCache.close();
    }
  });

  it("supports clearing cache", () => {
    cache.set("query 1", "data 1");
    cache.set("query 2", "data 2");
    expect(cache.get("query 1")).toBe("data 1");
    expect(cache.get("query 2")).toBe("data 2");

    cache.clear();
    expect(cache.get("query 1")).toBeNull();
    expect(cache.get("query 2")).toBeNull();
  });

  it("can be instantiated with default options without errors", () => {
    const defaultCache = new CacheService({ dbPath: ":memory:" });
    try {
      defaultCache.set("test default", "val");
      expect(defaultCache.get("test default")).toBe("val");
    } finally {
      defaultCache.close();
    }
  });

  it("closes database connection on close()", () => {
    const tempCache = new CacheService({ dbPath: ":memory:" });
    tempCache.set("foo", "bar");
    tempCache.close();
    expect(() => tempCache.get("foo")).toThrow();
  });

  it("persists entries across service instances with file database", () => {
    const tempDbPath = "/tmp/test-nanosearch-cache.db";
    const cache1 = new CacheService({ dbPath: tempDbPath });
    cache1.set("persistent query", "persistent value");
    cache1.close();

    const cache2 = new CacheService({ dbPath: tempDbPath });
    try {
      expect(cache2.get("persistent query")).toBe("persistent value");
    } finally {
      cache2.close();
      import("node:fs").then((fs) => {
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      });
    }
  });
});
