import { describe, it, expect } from "vitest";
import type { SearchResult, ExtractedSource, SearchResponse, CacheEntry } from "../src/types.js";

describe("Type Definitions", () => {
  it("allows instantiating search and extraction objects", () => {
    const sample: SearchResult = {
      title: "Example Title",
      url: "https://example.com",
      snippet: "An example snippet",
    };
    expect(sample.title).toBe("Example Title");

    const source: ExtractedSource = {
      title: "Sample",
      url: "https://example.com/page",
      domain: "example.com",
      content: "Important facts",
      credibility: "high",
    };
    expect(source.credibility).toBe("high");

    const response: SearchResponse = {
      query: "test query",
      sources: [source],
      formattedOutput: "test output",
    };
    expect(response.sources).toHaveLength(1);

    const cache: CacheEntry = {
      key: "abc123hash",
      query: "test query",
      result: "cached output",
      createdAt: 1000,
      expiresAt: 2000,
    };
    expect(cache.key).toBe("abc123hash");
  });
});
