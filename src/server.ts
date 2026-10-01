import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { CacheService } from "./cache/cache-service.js";
import { SearchScraper } from "./search/search-scraper.js";
import { FilterService } from "./filter/filter-service.js";
import { ContentExtractor } from "./extractor/content-extractor.js";
import { OutputFormatter } from "./formatter/output-formatter.js";
import type { ExtractedSource } from "./types.js";

export interface ServerOptions {
  dbPath?: string;
  defaultTtlMs?: number;
  cache?: CacheService;
  scraper?: SearchScraper;
  filter?: FilterService;
  extractor?: ContentExtractor;
  formatter?: OutputFormatter;
}

export class AeroSearchServer {
  public cache: CacheService;
  public scraper: SearchScraper;
  public filter: FilterService;
  public extractor: ContentExtractor;
  public formatter: OutputFormatter;
  public mcpServer: Server;

  constructor(options: ServerOptions = {}) {
    this.cache = options.cache ?? new CacheService({ dbPath: options.dbPath, defaultTtlMs: options.defaultTtlMs });
    this.scraper = options.scraper ?? new SearchScraper();
    this.filter = options.filter ?? new FilterService();
    this.extractor = options.extractor ?? new ContentExtractor();
    this.formatter = options.formatter ?? new OutputFormatter();

    this.mcpServer = new Server(
      {
        name: "aerosearch-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupMcpHandlers();
  }

  public getCurrentDate(): string {
    const now = new Date();
    const fullDate = now.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const iso = now.toISOString().split("T")[0];
    const time = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return `Tanggal saat ini: ${fullDate}, pukul ${time} WIB (ISO: ${iso}). Tahun berjalan: ${now.getFullYear()}.`;
  }

  public enrichQuery(query: string): string {
    const currentYear = new Date().getFullYear().toString();
    let q = query;

    const hasRecentIntent = /terkini|terbaru|hari\s+ini|latest|recent|today|current|now|sekarang/i.test(q);
    if (hasRecentIntent) {
      q = q.replace(/\b(2020|2021|2022|2023|2024|2025)\b/g, currentYear);
    }

    const words = q.trim().split(/\s+/);
    if (words.length > 7) {
      const stopWords = new Set([
        "breakthrough",
        "breakthroughs",
        "industry",
        "news",
        "berita",
        "terkini",
        "tentang",
        "pada",
        "saat",
        "ini",
        "information",
        "updates",
      ]);
      const filtered = words.filter((w) => !stopWords.has(w.toLowerCase()));
      if (filtered.length >= 3) {
        q = filtered.slice(0, 6).join(" ");
      } else {
        q = words.slice(0, 6).join(" ");
      }
    }

    return q;
  }

  public extractDirectUrl(query: string): string | null {
    const urlMatch = query.match(/https?:\/\/[^\s"'<>]+/i);
    if (!urlMatch) return null;
    try {
      const parsed = new URL(urlMatch[0]);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
    } catch {}
    return null;
  }

  public async handleSearch(query: string): Promise<string> {
    const rawTrimmed = query.trim();
    if (!rawTrimmed) {
      return "Please provide a valid search query.";
    }

    const directUrl = this.extractDirectUrl(rawTrimmed);
    if (directUrl) {
      const cachedDirect = this.cache.get(directUrl);
      if (cachedDirect) {
        return cachedDirect;
      }

      const extracted = await this.extractor.fetchAndExtract(directUrl, rawTrimmed, 4000);
      if (extracted) {
        const output = this.formatter.formatSources(rawTrimmed, [extracted]);
        this.cache.set(directUrl, output);
        return output;
      }
      return `Unable to extract content directly from URL: ${directUrl}. Please verify the link is accessible.`;
    }

    const trimmed = this.enrichQuery(rawTrimmed);

    const cached = this.cache.get(trimmed);
    if (cached) {
      return cached;
    }

    const rawResults = await this.scraper.search(trimmed);

    // 3. Filter Ads & Blacklisted Domains
    const filteredResults = this.filter.filterAndDeduplicate(rawResults, 3);

    // 4. Parallel Extraction with Smart Windowing
    const fetchPromises = filteredResults.map(async (item) => {
      let domain = item.domain || "unknown";
      if (domain === "unknown") {
        try {
          domain = new URL(item.url).hostname;
        } catch {}
      }

      const isSpecializedApi = /open-meteo|coingecko|npmjs|pypi|bmkg\.go\.id/i.test(domain);
      if (isSpecializedApi && item.snippet && item.snippet.length > 25) {
        return {
          title: item.title,
          url: item.url,
          domain,
          content: item.snippet,
          credibility: "high" as const,
        };
      }

      const extracted = await this.extractor.fetchAndExtract(item.url, trimmed, 3500);
      if (extracted) return extracted;

      return {
        title: item.title,
        url: item.url,
        domain,
        content: item.snippet || "No detailed content accessible.",
        credibility: "medium" as const,
      };
    });

    const settled = await Promise.allSettled(fetchPromises);
    const validSources: ExtractedSource[] = [];

    for (const item of settled) {
      if (item.status === "fulfilled" && item.value) {
        validSources.push(item.value);
      }
    }

    // 5. Format & Sanitize
    const output = this.formatter.formatSources(trimmed, validSources);

    // 6. Cache store
    if (validSources.length > 0) {
      this.cache.set(trimmed, output);
    }

    return output;
  }

  private setupMcpHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_current_date",
            description: "Get the current real-world date, day of week, month, and year. Call this tool whenever you need to check today's date or current time.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "web_search",
            description: "Live web search engine. Call this tool whenever the user asks about current software or AI versions (e.g. ChatGPT, GPT, Claude, iOS, Node), latest technology, releases, news, or real-world facts. NEVER guess versions or current events from internal memory; ALWAYS use web_search to find the true current status.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search keywords to look up on the web",
                },
              },
              required: ["query"],
            },
          },
        ],
      };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "get_current_date") {
        return {
          content: [
            {
              type: "text",
              text: this.getCurrentDate(),
            },
          ],
        };
      }

      if (request.params.name === "web_search") {
        const query = (request.params.arguments?.query as string) || "";
        const result = await this.handleSearch(query);
        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
        };
      }

      throw new Error(`Tool not found: ${request.params.name}`);
    });
  }

  public async start(transport?: Transport): Promise<void> {
    const serverTransport = transport ?? new StdioServerTransport();
    await this.mcpServer.connect(serverTransport);
    console.error("AeroSearch MCP Server running on stdio");
  }

  public async close(): Promise<void> {
    try {
      await this.mcpServer.close();
    } catch {
      // Ignore if server was not connected
    }
    this.cache.close();
  }
}

export { AeroSearchServer as NanoSearchServer };
