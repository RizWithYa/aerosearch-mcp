import * as cheerio from "cheerio";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { ExtractedSource } from "../types.js";

export class ContentExtractor {
  private userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ];

  private getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  public stripNoise(text: string): string {
    const noiseLinePatterns = [
      /^\s*baca\s+juga\s*:.*/i,
      /^\s*read\s+also\s*:.*/i,
      /^\s*see\s+also\s*:.*/i,
      /^\s*simak\s+(juga\s+)?video\s*.*/i,
      /^\s*tonton\s+(juga\s+)?video\s*.*/i,
      /^\s*pilihan\s+editor\s*:.*/i,
      /^\s*recommended\s*(reading|stories)?\s*:.*/i,
      /^\s*related\s*(articles?|stories|posts)?\s*:.*/i,
      /^\s*halaman\s+\d+\s+dari\s+\d+\s*$/i,
      /^\s*page\s+\d+\s+of\s+\d+\s*$/i,
      /^\s*halaman\s+selanjutnya\s*$/i,
      /^\s*advertisement\s*$/i,
      /^\s*scroll\s+to\s+continue\s+with\s+content\s*$/i,
      /sign\s+up\s+for\s+.*newsletter/i,
      /subscribe\s+to\s+.*newsletter/i,
      /langganan\s+(newsletter|berita)/i,
    ];

    const lines = text.split("\n");
    const cleanedLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      for (const pattern of noiseLinePatterns) {
        if (pattern.test(trimmed)) {
          return false;
        }
      }
      return true;
    });

    return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  public cleanHtml(html: string, url: string): { title: string; text: string } {
    try {
      const { document } = parseHTML(html);
      const reader = new Readability(document as unknown as Document);
      const article = reader.parse();

      if (article && article.textContent && article.textContent.trim().length > 150) {
        return {
          title: article.title || document.title || "Web Document",
          text: this.stripNoise(article.textContent.trim()),
        };
      }
    } catch {
      // Fallback to cheerio if readability fails
    }

    const $ = cheerio.load(html);
    const metaDesc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    $("script, style, noscript, nav, footer, header, svg, iframe, form").remove();

    const title = $("title").text().trim() || "Web Document";
    const rawText = $("body").text().replace(/\s+/g, " ").trim();
    let text = this.stripNoise(rawText);

    if (text.length < 100 && metaDesc) {
      text = `${metaDesc}. ${text}`.trim();
    }

    return { title, text };
  }

  public findSmartWindow(text: string, query: string, maxChars: number = 1200): string {
    const paragraphs = text
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 40);

    if (paragraphs.length === 0) {
      return text.slice(0, maxChars);
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    let bestIdx = 0;
    let maxScore = -1;

    paragraphs.forEach((p, idx) => {
      const lower = p.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) {
          score += 1;
        }
      }
      if (score > maxScore) {
        maxScore = score;
        bestIdx = idx;
      }
    });

    const startIdx = Math.max(0, bestIdx - 1);
    const endIdx = Math.min(paragraphs.length - 1, bestIdx + 2);

    let collected = paragraphs.slice(startIdx, endIdx + 1).join("\n\n");
    if (collected.length > maxChars) {
      const sliced = collected.slice(0, maxChars);
      const lastDot = Math.max(sliced.lastIndexOf("."), sliced.lastIndexOf("!"), sliced.lastIndexOf("?"));
      if (lastDot > maxChars * 0.6) {
        collected = sliced.slice(0, lastDot + 1);
      } else {
        collected = sliced;
      }
    }

    return collected.trim();
  }

  public async fetchAndExtract(url: string, query: string, timeoutMs: number = 3500): Promise<ExtractedSource | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": this.getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24"',
          "Sec-CH-UA-Mobile": "?0",
          "Sec-CH-UA-Platform": '"Linux"',
        },
      });

      if (!res.ok) return null;

      const html = await res.text();
      const { title, text } = this.cleanHtml(html, url);

      if (!text || text.length < 100) return null;

      const windowContent = this.findSmartWindow(text, query, 1200);
      const domain = new URL(url).hostname;

      return {
        title,
        url,
        domain,
        content: windowContent,
        credibility: domain.endsWith(".edu") || domain.endsWith(".gov") || domain.endsWith(".org") ? "high" : "medium",
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
