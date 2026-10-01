import * as cheerio from "cheerio";
import type { SearchResult } from "../types.js";

export interface SearchScraperOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SearchScraper {
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;

  private readonly defaultHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };

  constructor(options?: SearchScraperOptions) {
    this.fetchFn = options?.fetch;
    this.timeoutMs = options?.timeoutMs ?? 5000;
  }

  private async doFetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const fn = this.fetchFn ?? globalThis.fetch;
    return fn(url, init);
  }

  private decodeDuckDuckGoUrl(href: string): string {
    if (!href) return "";

    try {
      const urlToParse = href.startsWith("//") ? `https:${href}` : href;
      const parsed = new URL(urlToParse, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        try {
          return decodeURIComponent(uddg);
        } catch {
          return uddg;
        }
      }

      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        if (parsed.hostname.includes("duckduckgo.com") && !href.startsWith("http")) {
          return "";
        }
        if (href.startsWith("http://") || href.startsWith("https://")) {
          return href;
        }
        return parsed.href;
      }
      return "";
    } catch {
      const match = href.match(/[?&]uddg=([^&]+)/);
      if (match) {
        try {
          return decodeURIComponent(match[1]);
        } catch {
          return match[1];
        }
      }
      return href;
    }
  }

  public parseDuckDuckGoHtml(html: string): SearchResult[] {
    if (!html || typeof html !== "string") {
      return [];
    }

    const $ = cheerio.load(html);
    $(".result--ad").remove();

    const results: SearchResult[] = [];

    $(".result__body").each((_, el) => {
      const $el = $(el);
      if ($el.hasClass("result--ad") || $el.closest(".result--ad").length > 0) {
        return;
      }

      const linkEl = $el.find(".result__title a, .result__a, h2 a, a").first();
      const title = linkEl.text().replace(/\s+/g, " ").trim();
      const rawHref = linkEl.attr("href") || "";

      if (!title || !rawHref) {
        return;
      }

      const snippet = (
        $el.find(".result__snippet, .result__snippet__body, .result__snippet-body").first().text() ||
        $el.find("p").first().text() ||
        ""
      ).replace(/\s+/g, " ").trim();

      const decodedUrl = this.decodeDuckDuckGoUrl(rawHref);
      if (!decodedUrl || (!decodedUrl.startsWith("http://") && !decodedUrl.startsWith("https://"))) {
        return;
      }

      results.push({
        title,
        url: decodedUrl,
        snippet,
      });
    });

    return results;
  }

  private decodeBingUrl(rawUrl: string): string {
    try {
      const u = new URL(rawUrl, "https://www.bing.com");
      if (u.hostname.includes("bing.com") && u.pathname.includes("/ck/a")) {
        const uParam = u.searchParams.get("u");
        if (uParam && uParam.startsWith("a1")) {
          const b64 = uParam.slice(2);
          const decoded = Buffer.from(b64, "base64").toString("utf8");
          if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
            return decoded;
          }
        }
      }
      return u.href;
    } catch {
      return rawUrl;
    }
  }

  public parseBingHtml(html: string): SearchResult[] {
    if (!html || typeof html !== "string") {
      return [];
    }

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $("li.b_algo").each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find("h2 a").first();
      const title = linkEl.text().replace(/\s+/g, " ").trim();
      const rawHref = linkEl.attr("href") || "";

      if (!title || !rawHref) {
        return;
      }

      const snippet = (
        $el.find(".b_caption p, .b_snippet, p, .b_caption").first().text() ||
        ""
      ).replace(/\s+/g, " ").trim();

      let finalUrl = rawHref;
      try {
        const parsed = new URL(rawHref, "https://www.bing.com");
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return;
        }
        finalUrl = this.decodeBingUrl(parsed.href);
      } catch {
        if (!rawHref.startsWith("http://") && !rawHref.startsWith("https://")) {
          return;
        }
        finalUrl = this.decodeBingUrl(rawHref);
      }

      results.push({
        title,
        url: finalUrl,
        snippet,
      });
    });

    return results;
  }

  public async searchDuckDuckGo(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
      const res = await this.doFetch(url, {
        method: "GET",
        headers: {
          ...this.defaultHeaders,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`DuckDuckGo search failed with status ${res.status}`);
      }

      const html = await res.text();
      return this.parseDuckDuckGoHtml(html);
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchBing(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("q", trimmed);

      const res = await this.doFetch(url.toString(), {
        method: "GET",
        headers: {
          ...this.defaultHeaders,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Bing search failed with status ${res.status}`);
      }

      const html = await res.text();
      return this.parseBingHtml(html);
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchDuckDuckGoApi(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(trimmed)}&format=json`;
      const res = await this.doFetch(url, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const data = (await res.json()) as {
        AbstractURL?: string;
        Heading?: string;
        AbstractText?: string;
        RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
      };

      const results: SearchResult[] = [];
      if (data.AbstractURL && data.AbstractURL.startsWith("http")) {
        results.push({
          title: data.Heading || trimmed,
          url: data.AbstractURL,
          snippet: data.AbstractText || "",
        });
      }

      if (Array.isArray(data.RelatedTopics)) {
        for (const topic of data.RelatedTopics) {
          if (topic.FirstURL && topic.FirstURL.startsWith("http") && topic.Text) {
            results.push({
              title: topic.Text.split(" - ")[0] || trimmed,
              url: topic.FirstURL,
              snippet: topic.Text,
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchHn(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(trimmed)}&hitsPerPage=10`;
      const res = await this.doFetch(url, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const data = (await res.json()) as {
        hits?: Array<{ url?: string; title?: string; story_text?: string }>;
      };

      const results: SearchResult[] = [];
      if (Array.isArray(data.hits)) {
        for (const hit of data.hits) {
          if (hit.url && (hit.url.startsWith("http://") || hit.url.startsWith("https://")) && hit.title) {
            results.push({
              title: hit.title,
              url: hit.url,
              snippet: hit.story_text || hit.title,
            });
          }
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchWikipedia(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(trimmed)}&format=json`;
      const res = await this.doFetch(url, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const data = (await res.json()) as {
        query?: {
          search?: Array<{ title: string; snippet: string }>;
        };
      };

      const results: SearchResult[] = [];
      if (data.query && Array.isArray(data.query.search)) {
        for (const item of data.query.search.slice(0, 5)) {
          const cleanSnippet = item.snippet.replace(/<[^>]+>/g, " ").trim();
          results.push({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
            snippet: cleanSnippet,
          });
        }
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchGoogleNews(query: string): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(trimmed)}&hl=id&gl=ID&ceid=ID:id`;
      const res = await this.doFetch(url, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const text = await res.text();
      const $ = cheerio.load(text, { xml: true });
      const results: SearchResult[] = [];

      $("item").each((_, el) => {
        const title = $(el).find("title").text().trim();
        const link = $(el).find("link").text().trim();
        const sourceEl = $(el).find("source");
        const sourceName = sourceEl.text().trim();
        const sourceUrl = sourceEl.attr("url") || "";
        const pubDate = $(el).find("pubDate").text().trim();
        const desc = $(el).find("description").text().replace(/<[^>]+>/g, " ").trim();

        let articleDomain = "";
        try {
          if (sourceUrl) articleDomain = new URL(sourceUrl).hostname.toLowerCase();
        } catch {}

        if (title && link) {
          results.push({
            title,
            url: link,
            domain: articleDomain,
            snippet: `[${sourceName || articleDomain || "News"} | ${pubDate}]: ${title}. ${desc}`.trim(),
          });
        }
      });

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchBmkgGempa(query: string): Promise<SearchResult[]> {
    const isEarthquake = /gempa|seismic|lindu/i.test(query);
    if (!isEarthquake) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.doFetch("https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json", {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const json = (await res.json()) as {
        Infogempa?: {
          gempa?: {
            Tanggal?: string;
            Jam?: string;
            Magnitude?: string;
            Kedalaman?: string;
            Wilayah?: string;
            Potensi?: string;
            Dirasakan?: string;
          };
        };
      };

      const g = json?.Infogempa?.gempa;
      if (!g) return [];

      const results: SearchResult[] = [];
      results.push({
        title: `Laporan Gempa Bumi Terkini BMKG (${g.Tanggal} ${g.Jam})`,
        url: "https://www.bmkg.go.id/gempabumi-terkini.html",
        snippet: `Gempa bumi terkini tercatat BMKG pada ${g.Tanggal} pukul ${g.Jam}. Magnitudo: M ${g.Magnitude}, Kedalaman: ${g.Kedalaman}. Lokasi: ${g.Wilayah}. Dirasakan: ${g.Dirasakan || "-"}. Potensi: ${g.Potensi || "Tidak berpotensi tsunami"}.`,
      });

      try {
        const resDirasakan = await this.doFetch("https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json", {
          headers: this.defaultHeaders,
          signal: controller.signal,
        });
        if (resDirasakan.ok) {
          const jsonDirasakan = (await resDirasakan.json()) as {
            Infogempa?: {
              gempa?: Array<{
                Tanggal?: string;
                Jam?: string;
                Magnitude?: string;
                Kedalaman?: string;
                Wilayah?: string;
                Dirasakan?: string;
              }>;
            };
          };
          const list = jsonDirasakan?.Infogempa?.gempa?.slice(0, 3) || [];
          for (const item of list) {
            results.push({
              title: `Gempa Dirasakan BMKG: M ${item.Magnitude} ${item.Wilayah} (${item.Tanggal})`,
              url: "https://www.bmkg.go.id/gempabumi-dirasakan.html",
              snippet: `Pada ${item.Tanggal} jam ${item.Jam}, gempa M ${item.Magnitude} kedalaman ${item.Kedalaman} berpusat di ${item.Wilayah}. Skala getaran dirasakan: ${item.Dirasakan || "-"}.`,
            });
          }
        }
      } catch {}

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapWeatherCode(code: number): string {
    if (code === 0) return "Cerah (Clear Sky)";
    if (code >= 1 && code <= 3) return "Cerah Berawan / Berawan (Partly Cloudy)";
    if (code === 45 || code === 48) return "Berkabut (Foggy)";
    if (code >= 51 && code <= 55) return "Gerimis (Drizzle)";
    if (code >= 61 && code <= 65) return "Hujan (Rain)";
    if (code >= 80 && code <= 82) return "Hujan Lebat (Heavy Showers)";
    if (code >= 95) return "Badai Petir (Thunderstorm)";
    return "Berawan";
  }

  public async searchWeather(query: string): Promise<SearchResult[]> {
    const isWeather = /cuaca|weather|suhu|temperature|hujan|ramalan\s+cuaca/i.test(query);
    if (!isWeather) return [];

    let location = query
      .replace(/cuaca|weather|suhu|temperature|hujan|ramalan|hari\s+ini|saat\s+ini|terkini|di|pada|wilayah|kota|city/gi, "")
      .trim();

    if (!location) {
      location = "Jakarta";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=id&format=json`;
      const geoRes = await this.doFetch(geoUrl, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!geoRes.ok) return [];
      const geoData = (await geoRes.json()) as {
        results?: Array<{
          name: string;
          country: string;
          latitude: number;
          longitude: number;
          admin1?: string;
        }>;
      };

      if (!geoData.results || geoData.results.length === 0) return [];
      const place = geoData.results[0];

      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
      const weatherRes = await this.doFetch(weatherUrl, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!weatherRes.ok) return [];
      const weatherData = (await weatherRes.json()) as {
        current?: {
          temperature_2m: number;
          relative_humidity_2m: number;
          weather_code: number;
          wind_speed_10m: number;
        };
      };

      const cur = weatherData.current;
      if (!cur) return [];

      const cond = this.mapWeatherCode(cur.weather_code);
      const locStr = place.admin1 ? `${place.name}, ${place.admin1}, ${place.country}` : `${place.name}, ${place.country}`;

      return [
        {
          title: `Prakiraan Cuaca Terkini: ${locStr}`,
          url: "https://open-meteo.com",
          snippet: `Kondisi cuaca di ${locStr} saat ini: Suhu ${cur.temperature_2m}°C, Kondisi: ${cond}. Kelembapan relatif: ${cur.relative_humidity_2m}%, Kecepatan angin: ${cur.wind_speed_10m} km/h. Sumber stasiun: Open-Meteo Weather API.`,
          domain: "open-meteo.com",
        },
      ];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchCrypto(query: string): Promise<SearchResult[]> {
    const isCrypto = /kripto|crypto|bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|dogecoin|\bdoge\b/i.test(query);
    if (!isCrypto) return [];

    const coinMap: Record<string, string> = {
      bitcoin: "bitcoin",
      btc: "bitcoin",
      ethereum: "ethereum",
      eth: "ethereum",
      solana: "solana",
      sol: "solana",
      dogecoin: "dogecoin",
      doge: "dogecoin",
    };

    const targetCoins = new Set<string>();
    for (const [key, val] of Object.entries(coinMap)) {
      const reg = new RegExp(`\\b${key}\\b`, "i");
      if (reg.test(query)) {
        targetCoins.add(val);
      }
    }

    if (targetCoins.size === 0) {
      targetCoins.add("bitcoin");
    }

    const coinIds = Array.from(targetCoins).join(",");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd,idr&include_24hr_change=true`;
      const res = await this.doFetch(url, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (!res.ok) return [];
      const data = (await res.json()) as Record<
        string,
        { usd: number; idr: number; usd_24h_change?: number; idr_24h_change?: number }
      >;

      const results: SearchResult[] = [];
      for (const [id, price] of Object.entries(data)) {
        const name = id.toUpperCase();
        const chg = price.usd_24h_change !== undefined ? `${price.usd_24h_change > 0 ? "+" : ""}${price.usd_24h_change.toFixed(2)}%` : "0%";
        results.push({
          title: `Harga Kripto Real-Time: ${name}`,
          url: `https://www.coingecko.com/en/coins/${id}`,
          snippet: `Harga ${name}: $${price.usd.toLocaleString("en-US")} USD (Rp ${price.idr.toLocaleString("id-ID")} IDR). Perubahan 24 jam: ${chg}. Sumber: CoinGecko Crypto Index.`,
          domain: "coingecko.com",
        });
      }

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async searchPackageRegistry(query: string): Promise<SearchResult[]> {
    const isPkg = /versi\s+(package|pkg|npm|pypi|library)?|package.*versi|latest.*(npm|pypi|package)|package\s+version/i.test(query);
    if (!isPkg) return [];

    const clean = query
      .replace(/\b(version|versi|package|pkg|npm|pypi|library|libraries|terbaru|latest|release|apakah|ada|apa|berapa|of|the|in|for|di|js)\b|\.js\b/gi, " ")
      .trim();

    const pkgName = clean.split(/\s+/).filter((w) => w.length > 1)[0]?.toLowerCase();

    if (!pkgName) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const npmUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`;
      const npmRes = await this.doFetch(npmUrl, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (npmRes.ok) {
        const data = (await npmRes.json()) as {
          name: string;
          version: string;
          description?: string;
          license?: string;
          homepage?: string;
        };

        if (data.version) {
          return [
            {
              title: `Package Registry: ${data.name}`,
              url: `https://www.npmjs.com/package/${encodeURIComponent(data.name)}`,
              snippet: `Versi rilis stabil terbaru ${data.name}: v${data.version}. Lisensi: ${data.license || "MIT"}. Deskripsi: ${data.description || "NPM Package"}. Homepage: ${data.homepage || "https://npmjs.com"}.`,
              domain: "npmjs.com",
            },
          ];
        }
      }

      const pypiUrl = `https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`;
      const pypiRes = await this.doFetch(pypiUrl, {
        headers: this.defaultHeaders,
        signal: controller.signal,
      });

      if (pypiRes.ok) {
        const pypiData = (await pypiRes.json()) as {
          info: { name: string; version: string; summary?: string; license?: string; home_page?: string };
        };
        const info = pypiData.info;
        if (info && info.version) {
          return [
            {
              title: `Python Package: ${info.name}`,
              url: `https://pypi.org/project/${encodeURIComponent(info.name)}/`,
              snippet: `Versi stabil terbaru ${info.name}: v${info.version}. Ringkasan: ${info.summary || "PyPI Package"}. Lisensi: ${info.license || "Open Source"}.`,
              domain: "pypi.org",
            },
          ];
        }
      }

      return [];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  public async search(query: string): Promise<SearchResult[]> {
    if (!query || !query.trim()) {
      return [];
    }

    const isWeather = /cuaca|weather|suhu|temperature|hujan|ramalan\s+cuaca/i.test(query);
    if (isWeather) {
      try {
        const weatherResults = await this.searchWeather(query);
        if (weatherResults && weatherResults.length > 0) {
          return weatherResults;
        }
      } catch {}
    }

    const isCrypto = /kripto|crypto|bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|dogecoin|\bdoge\b/i.test(query);
    if (isCrypto) {
      try {
        const cryptoResults = await this.searchCrypto(query);
        if (cryptoResults && cryptoResults.length > 0) {
          return cryptoResults;
        }
      } catch {}
    }

    const isPkg = /versi\s+(package|pkg|npm|pypi|library)?|package.*versi|latest.*(npm|pypi|package)/i.test(query);
    if (isPkg) {
      try {
        const pkgResults = await this.searchPackageRegistry(query);
        if (pkgResults && pkgResults.length > 0) {
          return pkgResults;
        }
      } catch {}
    }

    const isEarthquake = /gempa|seismic|lindu/i.test(query);
    if (isEarthquake) {
      try {
        const bmkgResults = await this.searchBmkgGempa(query);
        const newsResults = await this.searchGoogleNews(query);
        const combined = [...bmkgResults, ...newsResults];
        if (combined.length > 0) {
          return combined;
        }
      } catch {}
    }

    const isNewsQuery = /berita|news|terkini|terbaru|latest|update|hari\s+ini|booming|viral/i.test(query);

    if (isNewsQuery) {
      try {
        const newsResults = await this.searchGoogleNews(query);
        if (newsResults && newsResults.length >= 2) {
          return newsResults;
        }
      } catch {}
    }

    try {
      const ddgResults = await this.searchDuckDuckGo(query);
      if (ddgResults && ddgResults.length >= 2) {
        return ddgResults;
      }
    } catch {}

    try {
      const bingResults = await this.searchBing(query);
      if (bingResults && bingResults.length >= 2) {
        return bingResults;
      }
    } catch {}

    const fallbackPromises = [
      this.searchGoogleNews(query),
      this.searchHn(query),
      this.searchDuckDuckGoApi(query),
      this.searchWikipedia(query),
    ];

    const results = await Promise.allSettled(fallbackPromises);
    const combined: SearchResult[] = [];

    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        combined.push(...r.value);
      }
    }

    return combined;
  }
}
