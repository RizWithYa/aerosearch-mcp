import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SearchScraper } from "../src/search/search-scraper.js";
import type { SearchResult } from "../src/types.js";

describe("SearchScraper", () => {
  let scraper: SearchScraper;

  beforeEach(() => {
    scraper = new SearchScraper();
  });

  describe("parseDuckDuckGoHtml", () => {
    it("parses valid DuckDuckGo HTML results with title, decoded URL, and snippet", () => {
      const html = `
        <div class="results">
          <div class="result results_links results_links_deep web-result">
            <div class="result__body">
              <h2 class="result__title">
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FJavaScript&rut=123">
                  JavaScript | MDN
                </a>
              </h2>
              <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FJavaScript">
                JavaScript (JS) is a lightweight interpreted programming language with first-class functions.
              </a>
            </div>
          </div>
          <div class="result results_links results_links_deep web-result">
            <div class="result__body">
              <h2 class="result__title">
                <a class="result__a" href="https://nodejs.org/en">
                  Node.js Official
                </a>
              </h2>
              <a class="result__snippet" href="https://nodejs.org/en">
                Node.js is an open-source, cross-platform JavaScript runtime.
              </a>
            </div>
          </div>
        </div>
      `;

      const results = scraper.parseDuckDuckGoHtml(html);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "JavaScript | MDN",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
        snippet: "JavaScript (JS) is a lightweight interpreted programming language with first-class functions.",
      });
      expect(results[1]).toEqual({
        title: "Node.js Official",
        url: "https://nodejs.org/en",
        snippet: "Node.js is an open-source, cross-platform JavaScript runtime.",
      });
    });

    it("strips ads with .result--ad class", () => {
      const html = `
        <div class="results">
          <div class="result results_links results_links_deep highlight_ad result--ad">
            <div class="result__body">
              <h2 class="result__title">
                <a class="result__a" href="https://duckduckgo.com/y.js?ad_domain=example.com">
                  Sponsored Result
                </a>
              </h2>
              <a class="result__snippet" href="#">
                This is a sponsored advertisement.
              </a>
            </div>
          </div>
          <div class="result results_links results_links_deep web-result">
            <div class="result__body">
              <h2 class="result__title">
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freal-result">
                  Organic Result
                </a>
              </h2>
              <a class="result__snippet" href="#">
                Organic snippet text.
              </a>
            </div>
          </div>
        </div>
      `;

      const results = scraper.parseDuckDuckGoHtml(html);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Organic Result");
      expect(results[0].url).toBe("https://example.com/real-result");
    });

    it("decodes uddg redirect URLs correctly including query strings", () => {
      const html = `
        <div class="result__body">
          <h2 class="result__title">
            <a class="result__a" href="/l/?uddg=https%3A%2F%2Fgithub.com%2Fsearch%3Fq%3Dtest%26type%3Dcode&rut=456">
              GitHub Search
            </a>
          </h2>
          <a class="result__snippet">Find code on GitHub</a>
        </div>
      `;

      const results = scraper.parseDuckDuckGoHtml(html);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://github.com/search?q=test&type=code");
    });

    it("handles empty and malformed HTML gracefully", () => {
      expect(scraper.parseDuckDuckGoHtml("")).toEqual([]);
      expect(scraper.parseDuckDuckGoHtml("   ")).toEqual([]);
      expect(scraper.parseDuckDuckGoHtml("<div>No results here</div>")).toEqual([]);
      expect(scraper.parseDuckDuckGoHtml("<<malformed << >> html")).toEqual([]);
    });

    it("skips results missing valid titles or URLs", () => {
      const html = `
        <div class="result__body">
          <h2 class="result__title"><a class="result__a" href="">Empty URL</a></h2>
        </div>
        <div class="result__body">
          <h2 class="result__title"><a class="result__a" href="javascript:void(0)">JS URL</a></h2>
        </div>
        <div class="result__body">
          <h2 class="result__title"><a class="result__a" href="https://valid.com">Valid</a></h2>
          <a class="result__snippet">Valid snippet</a>
        </div>
      `;

      const results = scraper.parseDuckDuckGoHtml(html);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe("https://valid.com");
    });
  });

  describe("parseBingHtml", () => {
    it("parses valid Bing HTML results with li.b_algo", () => {
      const html = `
        <ol id="b_results">
          <li class="b_algo">
            <h2>
              <a href="https://www.typescriptlang.org/">TypeScript: JavaScript With Syntax For Types</a>
            </h2>
            <div class="b_caption">
              <p>TypeScript extends JavaScript by adding types to the language.</p>
            </div>
          </li>
          <li class="b_algo">
            <h2>
              <a href="https://github.com/microsoft/TypeScript">GitHub - microsoft/TypeScript</a>
            </h2>
            <div class="b_caption">
              <p>TypeScript is a superset of JavaScript that compiles to clean JavaScript.</p>
            </div>
          </li>
          <li class="b_ad">
            <h2><a href="https://ad.example.com">Ad title</a></h2>
          </li>
        </ol>
      `;

      const results = scraper.parseBingHtml(html);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "TypeScript: JavaScript With Syntax For Types",
        url: "https://www.typescriptlang.org/",
        snippet: "TypeScript extends JavaScript by adding types to the language.",
      });
      expect(results[1]).toEqual({
        title: "GitHub - microsoft/TypeScript",
        url: "https://github.com/microsoft/TypeScript",
        snippet: "TypeScript is a superset of JavaScript that compiles to clean JavaScript.",
      });
    });

    it("handles Bing results when snippet is in p tag or b_snippet", () => {
      const html = `
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://example.com/item">Item Title</a></h2>
            <p class="b_algoSlug">Fallback snippet inside p element directly.</p>
          </li>
        </ol>
      `;

      const results = scraper.parseBingHtml(html);
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe("Fallback snippet inside p element directly.");
    });

    it("handles empty and malformed Bing HTML gracefully", () => {
      expect(scraper.parseBingHtml("")).toEqual([]);
      expect(scraper.parseBingHtml("   ")).toEqual([]);
      expect(scraper.parseBingHtml("<div>Empty</div>")).toEqual([]);
      expect(scraper.parseBingHtml("<invalid << html")).toEqual([]);
    });
  });

  describe("searchDuckDuckGo", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends request with realistic desktop headers and returns parsed results", async () => {
      const mockHtml = `
        <div class="result__body">
          <h2 class="result__title">
            <a class="result__a" href="https://example.com">Example</a>
          </h2>
          <a class="result__snippet">Sample snippet</a>
        </div>
      `;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response);

      const results = await scraper.searchDuckDuckGo("test query");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Example");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl.toString()).toContain("duckduckgo.com");
      expect(calledInit).toBeDefined();
      const headers = calledInit?.headers as Record<string, string>;
      expect(headers).toBeDefined();
      expect(headers["User-Agent"]).toContain("Mozilla/5.0");
      expect(headers["Accept"]).toBeDefined();
    });

    it("returns empty array for empty query string without calling fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const results = await scraper.searchDuckDuckGo("   ");
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws error when response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
      } as Response);

      await expect(scraper.searchDuckDuckGo("blocked query")).rejects.toThrow();
    });
  });

  describe("searchBing", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends request to Bing with realistic desktop headers and returns parsed results", async () => {
      const mockHtml = `
        <ol id="b_results">
          <li class="b_algo">
            <h2><a href="https://bing-example.com">Bing Title</a></h2>
            <div class="b_caption"><p>Bing Snippet</p></div>
          </li>
        </ol>
      `;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as Response);

      const results = await scraper.searchBing("bing query");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Bing Title");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl.toString()).toContain("bing.com/search");
      expect(calledUrl.toString()).toContain("q=bing+query");
      const headers = calledInit?.headers as Record<string, string>;
      expect(headers["User-Agent"]).toContain("Mozilla/5.0");
    });

    it("returns empty array for empty query string without calling fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const results = await scraper.searchBing("");
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws error when response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(scraper.searchBing("failing query")).rejects.toThrow();
    });
  });

  describe("search (multi-engine with fallback)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns DuckDuckGo results when DDG succeeds and returns results", async () => {
      const ddgResults: SearchResult[] = [
        { title: "DDG 1", url: "https://ddg1.com", snippet: "Snippet 1" },
        { title: "DDG 2", url: "https://ddg2.com", snippet: "Snippet 2" },
      ];
      const searchDdgSpy = vi.spyOn(scraper, "searchDuckDuckGo").mockResolvedValueOnce(ddgResults);
      const searchBingSpy = vi.spyOn(scraper, "searchBing");

      const results = await scraper.search("hello");
      expect(results).toEqual(ddgResults);
      expect(searchDdgSpy).toHaveBeenCalledWith("hello");
      expect(searchBingSpy).not.toHaveBeenCalled();
    });

    it("falls back to Bing when DuckDuckGo returns empty results", async () => {
      const bingResults: SearchResult[] = [
        { title: "Bing 1", url: "https://bing1.com", snippet: "Bing Snippet 1" },
        { title: "Bing 2", url: "https://bing2.com", snippet: "Bing Snippet 2" },
      ];
      const searchDdgSpy = vi.spyOn(scraper, "searchDuckDuckGo").mockResolvedValueOnce([]);
      const searchBingSpy = vi.spyOn(scraper, "searchBing").mockResolvedValueOnce(bingResults);

      const results = await scraper.search("rare keyword");
      expect(results).toEqual(bingResults);
      expect(searchDdgSpy).toHaveBeenCalledWith("rare keyword");
      expect(searchBingSpy).toHaveBeenCalledWith("rare keyword");
    });

    it("falls back to Bing when DuckDuckGo throws an error", async () => {
      const bingResults: SearchResult[] = [
        { title: "Bing Fallback", url: "https://bing.com/fallback", snippet: "Fallback Snippet" },
        { title: "Bing Fallback 2", url: "https://bing.com/fallback2", snippet: "Fallback Snippet 2" },
      ];
      vi.spyOn(scraper, "searchDuckDuckGo").mockRejectedValueOnce(new Error("DDG Rate Limited"));
      const searchBingSpy = vi.spyOn(scraper, "searchBing").mockResolvedValueOnce(bingResults);

      const results = await scraper.search("rate limited keyword");
      expect(results).toEqual(bingResults);
      expect(searchBingSpy).toHaveBeenCalledWith("rate limited keyword");
    });

    it("falls back to secondary sources when both DuckDuckGo and Bing fail", async () => {
      vi.spyOn(scraper, "searchDuckDuckGo").mockRejectedValueOnce(new Error("DDG Failed"));
      vi.spyOn(scraper, "searchBing").mockRejectedValueOnce(new Error("Bing Failed"));
      vi.spyOn(scraper, "searchGoogleNews").mockResolvedValueOnce([]);
      vi.spyOn(scraper, "searchHn").mockResolvedValueOnce([
        { title: "HN Result", url: "https://example.com/hn", snippet: "HN Snippet" },
      ]);
      vi.spyOn(scraper, "searchDuckDuckGoApi").mockResolvedValueOnce([]);
      vi.spyOn(scraper, "searchWikipedia").mockResolvedValueOnce([]);

      const results = await scraper.search("both fail");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("HN Result");
    });

    it("returns empty array when all search engines and fallbacks fail", async () => {
      vi.spyOn(scraper, "searchDuckDuckGo").mockRejectedValueOnce(new Error("DDG Failed"));
      vi.spyOn(scraper, "searchBing").mockRejectedValueOnce(new Error("Bing Failed"));
      vi.spyOn(scraper, "searchGoogleNews").mockResolvedValueOnce([]);
      vi.spyOn(scraper, "searchHn").mockRejectedValueOnce(new Error("HN Failed"));
      vi.spyOn(scraper, "searchDuckDuckGoApi").mockRejectedValueOnce(new Error("DDG API Failed"));
      vi.spyOn(scraper, "searchWikipedia").mockRejectedValueOnce(new Error("Wiki Failed"));

      const results = await scraper.search("all fail");
      expect(results).toEqual([]);
    });

    it("returns empty array when query is empty without searching", async () => {
      const searchDdgSpy = vi.spyOn(scraper, "searchDuckDuckGo");
      const searchBingSpy = vi.spyOn(scraper, "searchBing");

      const results = await scraper.search("   ");
      expect(results).toEqual([]);
      expect(searchDdgSpy).not.toHaveBeenCalled();
      expect(searchBingSpy).not.toHaveBeenCalled();
    });

    it("triggers specialized weather handler for weather queries", async () => {
      vi.spyOn(scraper, "searchWeather").mockResolvedValueOnce([
        {
          title: "Prakiraan Cuaca Terkini: Bandung",
          url: "https://open-meteo.com",
          snippet: "Suhu saat ini 24°C, Cerah Berawan. Kelembapan: 70%. Kecepatan angin: 8 km/h.",
          domain: "open-meteo.com",
        },
      ]);

      const results = await scraper.search("cuaca Bandung hari ini");
      expect(results).toHaveLength(1);
      expect(results[0].title).toContain("Prakiraan Cuaca");
      expect(results[0].snippet).toContain("24°C");
    });

    it("triggers specialized crypto handler for cryptocurrency queries", async () => {
      vi.spyOn(scraper, "searchCrypto").mockResolvedValueOnce([
        {
          title: "Harga Kripto Real-Time: Bitcoin (BTC)",
          url: "https://coingecko.com",
          snippet: "Harga Bitcoin (BTC): $83,422 USD (Rp 1,496,239,444 IDR). Perubahan 24 jam: +0.42%.",
          domain: "coingecko.com",
        },
      ]);

      const results = await scraper.search("harga bitcoin hari ini");
      expect(results).toHaveLength(1);
      expect(results[0].title).toContain("Bitcoin");
      expect(results[0].snippet).toContain("83,422");
    });

    it("triggers specialized package registry handler for library version queries", async () => {
      vi.spyOn(scraper, "searchPackageRegistry").mockResolvedValueOnce([
        {
          title: "Package Registry: typescript",
          url: "https://www.npmjs.com/package/typescript",
          snippet: "Versi rilis stabil terbaru: v7.0.2 (License: Apache-2.0).",
          domain: "npmjs.com",
        },
      ]);

      const results = await scraper.search("versi package typescript terbaru");
      expect(results).toHaveLength(1);
      expect(results[0].title).toContain("typescript");
      expect(results[0].snippet).toContain("v7.0.2");
    });
  });
});
