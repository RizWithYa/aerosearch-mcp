import type { SearchResult } from "../types.js";

export class FilterService {
  private readonly blockedDomains = new Set([
    "pinterest.com",
    "quora.com",
    "instagram.com",
    "facebook.com",
    "tiktok.com",
  ]);

  private readonly sponsoredPatterns = [
    /googleadservices\.com/i,
    /duckduckgo\.com\/y\.js/i,
    /bing\.com\/aclick/i,
    /doubleclick\.net/i,
    /taboola\.com/i,
    /outbrain\.com/i,
  ];

  private readonly trackingParams = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "mc_eid",
    "msclkid",
  ]);

  public cleanUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      const params = new URLSearchParams(parsed.search);
      for (const key of Array.from(params.keys())) {
        if (this.trackingParams.has(key.toLowerCase())) {
          params.delete(key);
        }
      }
      parsed.search = params.toString() ? `?${params.toString()}` : "";
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  }

  public isBlockedDomain(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      for (const blocked of this.blockedDomains) {
        if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
          return true;
        }
      }
      return false;
    } catch {
      return true;
    }
  }

  public isSponsored(title: string, url: string, snippet: string): boolean {
    for (const pattern of this.sponsoredPatterns) {
      if (pattern.test(url)) return true;
    }
    const combined = `${title} ${snippet}`.toLowerCase();
    if (combined.startsWith("ad ") || combined.includes("sponsored link")) {
      return true;
    }
    return false;
  }

  public isBareHomepage(url: string): boolean {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/+$/, "");
      return path === "" && u.search === "";
    } catch {
      return false;
    }
  }

  public filterAndDeduplicate(results: SearchResult[], limit: number = 3): SearchResult[] {
    const seenDomains = new Set<string>();
    const filtered: SearchResult[] = [];

    for (const item of results) {
      const cleanedUrl = this.cleanUrl(item.url);
      if (this.isSponsored(item.title, cleanedUrl, item.snippet)) continue;
      if (this.isBlockedDomain(cleanedUrl)) continue;

      let domain = (item.domain || "").toLowerCase();
      if (!domain) {
        try {
          domain = new URL(cleanedUrl).hostname.toLowerCase();
        } catch {
          continue;
        }
      }

      const isSpecialized = /coingecko|bmkg\.go\.id/i.test(domain);
      const dedupeKey = isSpecialized ? `${domain}:${item.title}` : domain;

      if (seenDomains.has(dedupeKey)) continue;
      seenDomains.add(dedupeKey);

      filtered.push({
        title: item.title.trim(),
        url: cleanedUrl,
        snippet: item.snippet.trim(),
        domain,
      });

      if (filtered.length >= limit) break;
    }

    return filtered;
  }
}
