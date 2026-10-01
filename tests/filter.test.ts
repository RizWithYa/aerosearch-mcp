import { describe, it, expect } from "vitest";
import { FilterService } from "../src/filter/filter-service.js";
import type { SearchResult } from "../src/types.js";

describe("FilterService", () => {
  const filter = new FilterService();

  describe("cleanUrl", () => {
    it("cleans tracking parameters from URLs", () => {
      const raw = "https://example.com/article?utm_source=twitter&utm_medium=social&gclid=12345&id=99";
      const cleaned = filter.cleanUrl(raw);
      expect(cleaned).toBe("https://example.com/article?id=99");
    });

    it("removes question mark when all query params are tracking params", () => {
      const raw = "https://example.com/page?utm_campaign=spring_sale&fbclid=abcdef";
      const cleaned = filter.cleanUrl(raw);
      expect(cleaned).toBe("https://example.com/page");
    });

    it("handles URL without query params", () => {
      const raw = "https://example.com/about";
      expect(filter.cleanUrl(raw)).toBe("https://example.com/about");
    });

    it("handles malformed URLs gracefully", () => {
      const malformed = "not-a-valid-url";
      expect(filter.cleanUrl(malformed)).toBe("not-a-valid-url");
    });
  });

  describe("isBlockedDomain", () => {
    it("detects blocked and low-value domains and subdomains", () => {
      expect(filter.isBlockedDomain("https://pinterest.com/pin/123")).toBe(true);
      expect(filter.isBlockedDomain("https://www.pinterest.com/pin/123")).toBe(true);
      expect(filter.isBlockedDomain("https://www.quora.com/What-is-X")).toBe(true);
      expect(filter.isBlockedDomain("https://sub.quora.com/topic")).toBe(true);
      expect(filter.isBlockedDomain("https://instagram.com/p/abc")).toBe(true);
      expect(filter.isBlockedDomain("https://www.facebook.com/user")).toBe(true);
      expect(filter.isBlockedDomain("https://tiktok.com/@creator")).toBe(true);
    });

    it("allows non-blocked legitimate domains", () => {
      expect(filter.isBlockedDomain("https://en.wikipedia.org/wiki/Node.js")).toBe(false);
      expect(filter.isBlockedDomain("https://github.com/nodejs/node")).toBe(false);
      expect(filter.isBlockedDomain("https://developer.mozilla.org/en-US/")).toBe(false);
    });

    it("blocks malformed URLs", () => {
      expect(filter.isBlockedDomain("invalid-url")).toBe(true);
    });
  });

  describe("isSponsored", () => {
    it("detects sponsored tracking redirects in url", () => {
      expect(filter.isSponsored("Ad Title", "https://googleadservices.com/pagead/aclk?sa=L", "Ad text")).toBe(true);
      expect(filter.isSponsored("Ad Title", "https://duckduckgo.com/y.js?ad_domain=example", "Ad text")).toBe(true);
      expect(filter.isSponsored("Search", "https://bing.com/aclick?ld=e8", "Some snippet")).toBe(true);
      expect(filter.isSponsored("Banner", "https://ad.doubleclick.net/ddm/clk", "Click here")).toBe(true);
      expect(filter.isSponsored("Sponsored Post", "https://taboola.com/referral", "Sponsored")).toBe(true);
      expect(filter.isSponsored("Promoted Content", "https://outbrain.com/traffic", "Outbrain")).toBe(true);
    });

    it("detects ad markers in title and snippet text", () => {
      expect(filter.isSponsored("Ad Cheap Shoes Online", "https://shoes.com", "Buy shoes here")).toBe(true);
      expect(filter.isSponsored("Best Deals", "https://deals.com", "Click this sponsored link now")).toBe(true);
    });

    it("allows normal search results", () => {
      expect(filter.isSponsored("Normal Article", "https://developer.mozilla.org", "MDN Docs")).toBe(false);
      expect(filter.isSponsored("Rust Guide", "https://rust-lang.org/learn", "Learn Rust")).toBe(false);
    });
  });

  describe("filterAndDeduplicate", () => {
    it("filters and deduplicates by domain with limit", () => {
      const results: SearchResult[] = [
        { title: "Doc 1", url: "https://example.com/page1?utm_source=test", snippet: "First" },
        { title: "Doc 2", url: "https://example.com/page2", snippet: "Duplicate domain" },
        { title: "Spam", url: "https://pinterest.com/pin/1", snippet: "Ignore" },
        { title: "Ad Title", url: "https://googleadservices.com/ad", snippet: "Ad" },
        { title: "Doc 3", url: "https://wikipedia.org/wiki/A", snippet: "Third" },
        { title: "Doc 4", url: "https://github.com/project", snippet: "Fourth" },
        { title: "Doc 5", url: "https://stackoverflow.com/q/1", snippet: "Fifth" }
      ];

      const filtered = filter.filterAndDeduplicate(results, 3);
      expect(filtered.length).toBe(3);
      expect(filtered[0]).toEqual({
        title: "Doc 1",
        url: "https://example.com/page1",
        snippet: "First",
        domain: "example.com",
      });
      expect(filtered[1].url).toBe("https://wikipedia.org/wiki/A");
      expect(filtered[2].url).toBe("https://github.com/project");
    });

    it("defaults to limit of 3 when limit is not provided", () => {
      const results: SearchResult[] = [
        { title: "Site 1", url: "https://site1.com", snippet: "S1" },
        { title: "Site 2", url: "https://site2.com", snippet: "S2" },
        { title: "Site 3", url: "https://site3.com", snippet: "S3" },
        { title: "Site 4", url: "https://site4.com", snippet: "S4" }
      ];

      const filtered = filter.filterAndDeduplicate(results);
      expect(filtered.length).toBe(3);
    });

    it("skips invalid URLs in results", () => {
      const results: SearchResult[] = [
        { title: "Invalid", url: ":::not a url:::", snippet: "Snippet" },
        { title: "Valid", url: "https://valid.com/page", snippet: "Valid Snippet" }
      ];

      const filtered = filter.filterAndDeduplicate(results, 2);
      expect(filtered.length).toBe(1);
      expect(filtered[0].url).toBe("https://valid.com/page");
    });

    it("allows distinct items from specialized domains (e.g. multiple coins from coingecko)", () => {
      const results: SearchResult[] = [
        { title: "Harga: BITCOIN", url: "https://coingecko.com/en/coins/bitcoin", domain: "coingecko.com", snippet: "BTC price" },
        { title: "Harga: ETHEREUM", url: "https://coingecko.com/en/coins/ethereum", domain: "coingecko.com", snippet: "ETH price" },
        { title: "Duplicate Detik 1", url: "https://detik.com/news/1", domain: "detik.com", snippet: "Detik 1" },
        { title: "Duplicate Detik 2", url: "https://detik.com/news/2", domain: "detik.com", snippet: "Detik 2" },
      ];

      const filtered = filter.filterAndDeduplicate(results, 3);
      expect(filtered).toHaveLength(3);
      expect(filtered.map(f => f.title)).toEqual([
        "Harga: BITCOIN",
        "Harga: ETHEREUM",
        "Duplicate Detik 1"
      ]);
    });
  });
});
