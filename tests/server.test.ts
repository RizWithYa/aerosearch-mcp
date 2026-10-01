import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NanoSearchServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("NanoSearchServer", () => {
  let server: NanoSearchServer;

  beforeEach(() => {
    server = new NanoSearchServer({ dbPath: ":memory:" });
  });

  afterEach(async () => {
    await server.close();
  });

  describe("Core Service Integration & handleSearch", () => {
    it("returns cached result when available without hitting search network", async () => {
      server.cache.set("cached query", "Immediate Cached Answer");
      const searchSpy = vi.spyOn(server.scraper, "search");

      const result = await server.handleSearch("cached query");

      expect(result).toBe("Immediate Cached Answer");
      expect(searchSpy).not.toHaveBeenCalled();
    });

    it("handles search end-to-end: search -> filter -> parallel fetch -> format -> cache set", async () => {
      const searchSpy = vi.spyOn(server.scraper, "search").mockResolvedValue([
        { title: "Doc 1", url: "https://example.com/page1", snippet: "Snippet 1" },
        { title: "Ad Title", url: "https://googleadservices.com/ad", snippet: "Ad snippet" },
        { title: "Doc 1 Dup", url: "https://example.com/page2", snippet: "Dup snippet" },
        { title: "Doc 2", url: "https://wikipedia.org/page", snippet: "Snippet 2" },
      ]);

      const fetchSpy = vi.spyOn(server.extractor, "fetchAndExtract").mockImplementation(async (url, query) => ({
        title: `Cleaned Title for ${url}`,
        url,
        domain: new URL(url).hostname,
        content: `Extracted content for ${query} at ${url}`,
        credibility: "high",
      }));

      const query = "quantum computing";
      const result = await server.handleSearch(query);

      expect(searchSpy).toHaveBeenCalledWith(query);
      // FilterService should filter out ad and duplicate domain, so only example.com and wikipedia.org are fetched
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledWith("https://example.com/page1", query, expect.any(Number));
      expect(fetchSpy).toHaveBeenCalledWith("https://wikipedia.org/page", query, expect.any(Number));

      // Output formatting assertions
      expect(result).toContain("Verified Web Consensus");
      expect(result).toContain("[SOURCE 1: example.com]");
      expect(result).toContain("[SOURCE 2: wikipedia.org]");
      expect(result).toContain(`Extracted content for ${query}`);

      // Verify result was saved in cache
      expect(server.cache.get(query)).toBe(result);
    });

    it("falls back to search snippet when fetchAndExtract fails/returns null", async () => {
      vi.spyOn(server.scraper, "search").mockResolvedValue([
        { title: "Unreachable Page", url: "https://paywalled.com/news", snippet: "Fallback snippet about AI" },
      ]);

      vi.spyOn(server.extractor, "fetchAndExtract").mockResolvedValue(null);

      const result = await server.handleSearch("AI news");

      expect(result).toContain("Verified Web Consensus");
      expect(result).toContain("[SOURCE 1: paywalled.com]");
      expect(result).toContain("Fallback snippet about AI");
    });

    it("handles empty or whitespace-only queries gracefully", async () => {
      const searchSpy = vi.spyOn(server.scraper, "search");

      const emptyRes = await server.handleSearch("");
      expect(emptyRes).toBe("Please provide a valid search query.");

      const spaceRes = await server.handleSearch("   \t  \n ");
      expect(spaceRes).toBe("Please provide a valid search query.");

      expect(searchSpy).not.toHaveBeenCalled();
    });

    it("handles queries with no search results found without crashing or caching empty results", async () => {
      vi.spyOn(server.scraper, "search").mockResolvedValue([]);

      const result = await server.handleSearch("nonexistent term 12345 xyz");

      expect(result).toContain("No verified web sources could be retrieved");
      expect(server.cache.get("nonexistent term 12345 xyz")).toBeNull();
    });

    it("detects direct URL input, bypasses search engines, and extracts target page directly", async () => {
      const searchSpy = vi.spyOn(server.scraper, "search");
      const extractSpy = vi.spyOn(server.extractor, "fetchAndExtract").mockResolvedValueOnce({
        title: "TypeScript Deep Dive",
        url: "https://example.com/ts-deep-dive",
        domain: "example.com",
        content: "Detailed documentation and examples about advanced TypeScript features.",
        credibility: "high",
      });

      const result = await server.handleSearch("https://example.com/ts-deep-dive");

      expect(searchSpy).not.toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalledWith("https://example.com/ts-deep-dive", expect.any(String), expect.any(Number));
      expect(result).toContain("TypeScript Deep Dive");
      expect(result).toContain("https://example.com/ts-deep-dive");
    });
  });

  describe("MCP Server Handlers & Stdio/Transport Integration", () => {
    let client: Client;
    let clientTransport: InMemoryTransport;
    let serverTransport: InMemoryTransport;

    beforeEach(async () => {
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.mcpServer.connect(serverTransport);

      client = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} }
      );
      await client.connect(clientTransport);
    });

    afterEach(async () => {
      await client.close();
    });

    it("ListToolsRequestSchema returns get_current_date and web_search tools", async () => {
      const response = await client.listTools();

      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBe(2);

      const dateTool = response.tools.find((t) => t.name === "get_current_date");
      expect(dateTool).toBeDefined();

      const searchTool = response.tools.find((t) => t.name === "web_search");
      expect(searchTool).toBeDefined();
      expect(searchTool?.inputSchema).toEqual({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: expect.any(String),
          },
        },
        required: ["query"],
      });
    });

    it("CallToolRequestSchema executes get_current_date and returns current date string", async () => {
      const response = await client.callTool({
        name: "get_current_date",
        arguments: {},
      });

      expect(response.content).toHaveLength(1);
      const content = response.content[0] as { type: string; text: string };
      expect(content.text).toContain("Tanggal saat ini");
    });

    it("CallToolRequestSchema executes handleSearch and returns formatted text content", async () => {
      const handleSearchSpy = vi.spyOn(server, "handleSearch").mockResolvedValue("Formatted Markdown Output");

      const response = await client.callTool({
        name: "web_search",
        arguments: { query: "vitest mocking" },
      });

      expect(handleSearchSpy).toHaveBeenCalledWith("vitest mocking");
      expect(response.content).toEqual([
        {
          type: "text",
          text: "Formatted Markdown Output",
        },
      ]);
    });

    it("CallToolRequestSchema passes empty string if query argument is omitted", async () => {
      const handleSearchSpy = vi.spyOn(server, "handleSearch").mockResolvedValue("Please provide a valid search query.");

      const response = await client.callTool({
        name: "web_search",
        arguments: {},
      });

      expect(handleSearchSpy).toHaveBeenCalledWith("");
      expect(response.content).toEqual([
        {
          type: "text",
          text: "Please provide a valid search query.",
        },
      ]);
    });

    it("CallToolRequestSchema throws an error when an unknown tool is invoked", async () => {
      await expect(
        client.callTool({
          name: "non_existent_tool",
          arguments: {},
        })
      ).rejects.toThrow("Tool not found: non_existent_tool");
    });

    it("connects to provided transport on start()", async () => {
      const customServer = new NanoSearchServer({ dbPath: ":memory:" });
      const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await customServer.start(sTransport);
      expect(consoleErrorSpy).toHaveBeenCalledWith("AeroSearch MCP Server running on stdio");

      const customClient = new Client({ name: "cli", version: "1.0.0" }, { capabilities: {} });
      await customClient.connect(cTransport);

      const tools = await customClient.listTools();
      expect(tools.tools.length).toBe(2);

      await customClient.close();
      await customServer.close();
      consoleErrorSpy.mockRestore();
    });
  });
});
