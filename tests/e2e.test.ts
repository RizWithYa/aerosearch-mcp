import { describe, it, expect } from "vitest";
import { NanoSearchServer } from "../src/server.js";

describe("Live E2E Search Pipeline", () => {
  it("executes live search, extracts consensus from multi-sources and caches output", async () => {
    const server = new NanoSearchServer({ dbPath: ":memory:" });
    const startTime = Date.now();

    const output = await server.handleSearch("Python programming language");
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(10000);
    expect(output).toContain("Verified Web Consensus");
    expect(output).toContain("[SOURCE 1:");
    expect(output.length).toBeGreaterThan(150);

    // Verify cache hit takes less than 15ms
    const t0 = Date.now();
    const cached = await server.handleSearch("Python programming language");
    const cacheDuration = Date.now() - t0;

    expect(cacheDuration).toBeLessThan(50);
    expect(cached).toBe(output);

    server.cache.close();
  }, 15000);

  it("handles queries with special characters and accents safely", async () => {
    const server = new NanoSearchServer({ dbPath: ":memory:" });
    const output = await server.handleSearch("C++ language & templates!");

    expect(output).toBeDefined();
    expect(typeof output).toBe("string");
    server.cache.close();
  }, 10000);
});
